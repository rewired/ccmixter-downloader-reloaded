import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildReviewedDryRunPlan,
  createDryRunPlanFromGroups,
  createReviewSessionFromDryRunPlan,
  renameGroup,
  toggleFileIncluded,
  type DryRunPlan,
  type StemGroup
} from '../../src/shared/domain';
import { CcmixterResolver } from '../../src/main/services/ccmixter/ccmixterResolver';
import { DownloadManager } from '../../src/main/services/download/downloadManager';
import type { DownloadFetcher, DownloadFetcherResponse } from '../../src/main/services/download/downloadTypes';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe('DownloadManager', () => {
  it('downloads a file under the selected root through a temp file first', async () => {
    const root = await tempRoot();
    const progressEvents: string[] = [];
    const manager = new DownloadManager({
      fetcher: fakeFetcher({
        'https://ccmixter.org/content/WiseMan/BASS.flac': responseFrom(['bass-data'])
      }),
      onProgress: (progress) => progressEvents.push(progress.status)
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root));
    const state = await manager.startDownloadJob(job.jobId);
    const target = path.join(root, 'Wiseman', 'Boxcar heading West (145 bpm)', 'BASS.flac');

    expect(state.status).toBe('completed');
    expect(await readFile(target, 'utf8')).toBe('bass-data');
    expect(await findTempFiles(root)).toEqual([]);
    expect(progressEvents).toContain('running');
  });

  it('reports usable progress when Content-Length is missing', async () => {
    const root = await tempRoot();
    const received: Array<{ received?: number; total?: number }> = [];
    const manager = new DownloadManager({
      fetcher: fakeFetcher({
        'https://ccmixter.org/content/WiseMan/BASS.flac': responseFrom(['abc'], { contentLength: null })
      }),
      onProgress: (progress) => received.push({ received: progress.receivedBytes, total: progress.totalBytes })
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root));

    await manager.startDownloadJob(job.jobId);

    expect(received.some((event) => event.received === 3 && event.total === undefined)).toBe(true);
  });

  it('marks failed downloads failed and removes temp files', async () => {
    const root = await tempRoot();
    const manager = new DownloadManager({
      fetcher: fakeFetcher({
        'https://ccmixter.org/content/WiseMan/BASS.flac': responseFrom(['nope'], { status: 500 })
      })
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root));
    const state = await manager.startDownloadJob(job.jobId);

    expect(state.status).toBe('failed');
    expect(state.files[0]?.status).toBe('failed');
    expect(await findTempFiles(root)).toEqual([]);
  });

  it('skips missing URLs without fetching', async () => {
    const root = await tempRoot();
    let fetchCount = 0;
    const manager = new DownloadManager({
      fetcher: async () => {
        fetchCount += 1;
        return responseFrom(['unexpected']);
      }
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root, { missingUrl: true }));
    const state = await manager.startDownloadJob(job.jobId);

    expect(fetchCount).toBe(0);
    expect(state.files[0]?.status).toBe('skipped');
    expect(state.status).toBe('completed');
  });

  it('blocks existing files before writing', async () => {
    const root = await tempRoot();
    const target = path.join(root, 'Wiseman', 'Boxcar heading West (145 bpm)', 'BASS.flac');
    await writeFileWithDir(target, 'existing');
    let fetchCount = 0;
    const manager = new DownloadManager({
      fetcher: async () => {
        fetchCount += 1;
        return responseFrom(['new']);
      }
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root));

    expect(job.status).toBe('failed');
    expect(job.errors.map((error) => error.code)).toContain('DOWNLOAD_TARGET_EXISTS');

    const state = await manager.startDownloadJob(job.jobId);
    expect(state.status).toBe('failed');
    expect(fetchCount).toBe(0);
    expect(await readFile(target, 'utf8')).toBe('existing');
  });

  it('uses unique temp files per job and file while active', async () => {
    const root = await tempRoot();
    let resolveFirstRead: (() => void) | undefined;
    const manager = new DownloadManager({
      fetcher: fakeFetcher({
        'https://ccmixter.org/content/WiseMan/BASS.flac': responseFrom(['bass-data'], {
          beforeClose: () => new Promise<void>((resolve) => {
            resolveFirstRead = resolve;
          })
        }),
        'https://ccmixter.org/content/WiseMan/VOCALS.flac': responseFrom(['vocals-data'])
      })
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root, { secondFile: true }));
    const startPromise = manager.startDownloadJob(job.jobId);

    await waitForTempFiles(root, 1);
    const activeTempFiles = await findTempFiles(root);
    expect(activeTempFiles).toHaveLength(1);
    expect(activeTempFiles[0]).toContain(job.files[0]!.fileJobId.replace(/[^a-zA-Z0-9._-]+/g, '-'));

    resolveFirstRead?.();
    const state = await startPromise;
    expect(state.status).toBe('completed');
    expect(await findTempFiles(root)).toEqual([]);
  });

  it('rejects redirect hops that leave the ccMixter allowlist', async () => {
    const root = await tempRoot();
    const manager = new DownloadManager({
      fetcher: fakeFetcher({
        'https://ccmixter.org/content/WiseMan/BASS.flac': responseFrom([], {
          status: 302,
          location: 'https://example.com/evil.flac'
        })
      })
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root));
    const state = await manager.startDownloadJob(job.jobId);

    expect(state.status).toBe('failed');
    expect(state.files[0]?.errors[0]?.message).toContain('Redirect target host is not allowed');
  });

  it('sends browser-style headers for ccMixter media requests', async () => {
    const root = await tempRoot();
    let headers: Record<string, string> | undefined;
    const manager = new DownloadManager({
      fetcher: async (_url, options) => {
        headers = options.headers;
        return responseFrom(['bass-data']);
      }
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root));

    await manager.startDownloadJob(job.jobId);

    expect(headers?.['User-Agent']).toContain('ccMixter Stem Downloader');
    expect(headers?.Referer).toBe('https://ccmixter.org/');
  });

  it('cancels active work, stops queued downloads, and removes temp files', async () => {
    const root = await tempRoot();
    let manager: DownloadManager;
    let jobId = '';
    manager = new DownloadManager({
      fetcher: abortableFetcher(['partial-data']),
      onProgress: (progress) => {
        if (progress.jobId === jobId && progress.receivedBytes && progress.receivedBytes > 0) {
          void manager.cancelDownloadJob(jobId);
        }
      }
    });
    const job = await manager.createJobFromReviewedPlan(createPlan(root, { secondFile: true }));
    jobId = job.jobId;
    const state = await manager.startDownloadJob(job.jobId);

    expect(state.status).toBe('cancelled');
    expect(state.files[0]?.status).toBe('cancelled');
    expect(state.files[1]?.status).toBe('cancelled');
    expect(await findTempFiles(root)).toEqual([]);
  });

  it('runs fixture smoke downloads through review state and the real download manager', async () => {
    const root = await smokeRoot();
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] }),
        resolveByUploadId: async () => []
      }
    });
    const dryRun = await resolver.createDryRunPlan('fixture:haze-smoke', {
      path: root,
      selectedAt: '2026-07-03T00:00:00.000Z'
    });
    let review = createReviewSessionFromDryRunPlan(dryRun);
    review = renameGroup(review, review.groups[0]!.reviewGroupId, 'Haze smoke review');

    const archiveFile = review.groups[0]!.files.find((file) => file.originalFile.fileKind === 'archive')!;
    review = toggleFileIncluded(review, archiveFile.fileId);
    const reviewedPlan = buildReviewedDryRunPlan(review, dryRun.stemLibraryRoot);
    const manager = new DownloadManager({
      fetcher: fakeFetcher({
        'https://ccmixter.org/content/Zutsuri/Zutsuri_-_Haze_1.mp3': responseFrom(['fixture-smoke-data'])
      })
    });
    const job = await manager.createJobFromReviewedPlan(reviewedPlan);
    const target = path.join(root, 'Zutsuri', 'Haze smoke review', 'Zutsuri_-_Haze_1.mp3');

    expect(dryRun.placeholderData).toBe(true);
    expect(dryRun.input.kind).toBe('fixture');
    expect(review.groups[0]?.files.some((file) => file.originalFile.fileKind === 'archive' && !file.included)).toBe(true);
    expect(reviewedPlan.plannedFiles.map((file) => file.sourceFile.originalFilename)).toEqual([
      'Zutsuri_-_Haze_1.mp3',
      'fixture-missing-url.wav'
    ]);
    expect(await collectFiles(root)).toEqual([]);
    expect(job.files.find((file) => file.originalFilename === 'fixture-missing-url.wav')?.status).toBe('skipped');

    const state = await manager.startDownloadJob(job.jobId);

    expect(state.status).toBe('completed');
    expect(state.progress.completedFiles).toBe(1);
    expect(state.progress.skippedFiles).toBe(1);
    expect(await readFile(target, 'utf8')).toBe('fixture-smoke-data');
    expect((await collectFiles(root)).map((file) => path.relative(root, file))).toEqual([
      path.join('Zutsuri', 'Haze smoke review', 'Zutsuri_-_Haze_1.mp3')
    ]);
    expect(await findTempFiles(root)).toEqual([]);
  });
});

function createPlan(rootPath: string, options: { missingUrl?: boolean; secondFile?: boolean } = {}): DryRunPlan {
  return createDryRunPlanFromGroups('WiseMan', { path: rootPath, selectedAt: '2026-07-03T00:00:00.000Z' }, [group(options)], {
    createdAt: '2026-07-03T00:00:00.000Z',
    metadataSource: 'api',
    placeholderData: false,
    resolverStatus: 'resolved',
    warnings: []
  });
}

function group(options: { missingUrl?: boolean; secondFile?: boolean }): StemGroup {
  return {
    groupId: 'group-a',
    artist: 'Wiseman',
    canonicalSongTitle: 'Boxcar heading West',
    bpm: 145,
    uploads: [],
    files: [
      {
        originalFilename: 'BASS.flac',
        fileKind: 'stem',
        extension: 'flac',
        downloadUrl: options.missingUrl ? undefined : 'https://ccmixter.org/content/WiseMan/BASS.flac',
        metadataSource: 'api',
        warnings: []
      },
      ...(options.secondFile
        ? [
            {
              originalFilename: 'VOCALS.flac',
              fileKind: 'stem' as const,
              extension: 'flac',
              downloadUrl: 'https://ccmixter.org/content/WiseMan/VOCALS.flac',
              metadataSource: 'api' as const,
              warnings: []
            }
          ]
        : [])
    ],
    confidence: 'high',
    metadataSource: 'api',
    groupingReasons: [],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: []
  };
}

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ccmixter-download-'));
  tempRoots.push(dir);
  return dir;
}

async function smokeRoot(): Promise<string> {
  const dir = path.join(tmpdir(), 'ccmixter-slice-5-5-smoke');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  tempRoots.push(dir);
  return dir;
}

function fakeFetcher(responses: Record<string, DownloadFetcherResponse>): DownloadFetcher {
  return async (url) => {
    const response = responses[url];
    if (!response) {
      return responseFrom(['missing fake response'], { status: 404 });
    }
    return response;
  };
}

function abortableFetcher(chunks: string[]): DownloadFetcher {
  return async (_url, options) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(chunks[0] ?? ''));
        options.signal.addEventListener(
          'abort',
          () => {
            controller.error(new Error('aborted'));
          },
          { once: true }
        );
      }
    });

    return responseFromStream(stream);
  };
}

function responseFrom(
  chunks: string[],
  options: {
    status?: number;
    location?: string;
    contentLength?: number | null;
    beforeClose?: () => Promise<void>;
  } = {}
): DownloadFetcherResponse {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(Buffer.from(chunk));
      }

      await options.beforeClose?.();
      controller.close();
    }
  });

  return responseFromStream(stream, options);
}

function responseFromStream(
  stream: ReadableStream<Uint8Array>,
  options: {
    status?: number;
    location?: string;
    contentLength?: number | null;
  } = {}
): DownloadFetcherResponse {
  const status = options.status ?? 200;
  const content = options.contentLength === null ? null : String(options.contentLength ?? 0);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    url: 'https://ccmixter.org/content/test',
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === 'location') {
          return options.location ?? null;
        }

        if (name.toLowerCase() === 'content-length') {
          return content;
        }

        return null;
      }
    },
    body: stream,
    async arrayBuffer() {
      return new ArrayBuffer(0);
    }
  };
}

async function writeFileWithDir(filePath: string, contents: string): Promise<void> {
  await import('fs/promises').then(async (fs) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, 'utf8');
  });
}

async function findTempFiles(root: string): Promise<string[]> {
  const files = await collectFiles(root);
  return files.filter((file) => path.basename(file).endsWith('.tmp')).map((file) => path.relative(root, file));
}

async function waitForTempFiles(root: string, count: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    if ((await findTempFiles(root)).length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} temp files.`);
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }
      return [fullPath];
    })
  );

  return nested.flat();
}
