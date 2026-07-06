import { describe, expect, it, vi } from 'vitest';

import { ARTIST_CATALOG_QUERY_LIMIT } from '../../src/main/services/ccmixter/ccmixterApiClient';
import { ArtistCatalogSessionManager } from '../../src/main/services/ccmixter/artistCatalogSessionManager';
import { buildTrackFile } from '../../src/main/services/ccmixter/ccmixterApiClient';
import type { CcmixterApiUploadMapping, CcmixterHtmlEnrichment } from '../../src/main/services/ccmixter/ccmixterTypes';

function makeMapping(uploadId: string, artistLogin = 'testArtist', files = [buildTrackFile(`test-${uploadId}.mp3`, `https://ccmixter.org/download/${uploadId}`, 'api')]): CcmixterApiUploadMapping {
  return {
    upload: {
      uploadId,
      artistName: 'Test Artist',
      artistLogin,
      title: `Test Upload ${uploadId}`,
      tags: ['test'],
      licenseSummary: 'CC BY',
      sourceUrl: `https://ccmixter.org/files/${artistLogin}/${uploadId}`,
      metadataSource: 'api',
      warnings: []
    },
    files,
    warnings: []
  };
}

function makePage(ids: string[]): { mappings: CcmixterApiUploadMapping[]; warnings: string[] } {
  return {
    mappings: ids.map((id) => makeMapping(id)),
    warnings: []
  };
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function delayReject(error: Error, ms: number): Promise<never> {
  return new Promise((_resolve, reject) => setTimeout(() => reject(error), ms));
}

describe('ArtistCatalogSessionManager', () => {
  it('enriches artist catalog entries with upload-page file candidates', async () => {
    const apiPage = vi.fn().mockResolvedValue({
      mappings: [makeMapping('1', 'testArtist', [])],
      warnings: []
    });
    const enrichUploadPage = vi.fn().mockResolvedValue(enrichmentWithFile('from-html-1.flac'));

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: {
        resolveArtistCatalogPage: async () => ({ mappings: [], nextPageUrls: [], totalCount: 1, warnings: [] }),
        enrichUploadPage
      }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');

    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.groups).toHaveLength(1);
    expect(start.value.downloadableFileCount).toBe(1);
    expect(start.value.noFilesFoundCount).toBe(0);
    expect(start.value.couldNotCheckFilesCount).toBe(0);
    expect(start.value.groups[0]?.files[0]?.originalFilename).toBe('from-html-1.flac');
    expect(enrichUploadPage).toHaveBeenCalledTimes(1);
  });

  it('separates successful no-file enrichment from failed upload-page checks', async () => {
    const apiPage = vi.fn().mockResolvedValue({
      mappings: [makeMapping('1', 'testArtist', []), makeMapping('2', 'testArtist', [])],
      warnings: []
    });
    const enrichUploadPage = vi.fn().mockImplementation(async (sourceUrl: string) => {
      if (sourceUrl.endsWith('/2')) {
        throw new Error('timeout');
      }
      return emptyEnrichment();
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: {
        resolveArtistCatalogPage: async () => ({ mappings: [], nextPageUrls: [], totalCount: 2, warnings: [] }),
        enrichUploadPage
      }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');

    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.groups).toEqual([]);
    expect(start.value.noFilesFoundCount).toBe(1);
    expect(start.value.couldNotCheckFilesCount).toBe(1);
    expect(start.value.noFilesFoundUploads[0]?.upload.uploadId).toBe('1');
    expect(start.value.couldNotCheckFilesUploads[0]?.upload.uploadId).toBe('2');
  });

  it('reuses upload-page enrichment within the same session', async () => {
    const first = makeMapping('1', 'testArtist', []);
    const second = makeMapping('2', 'testArtist', []);
    second.upload.sourceUrl = first.upload.sourceUrl;
    const apiPage = vi.fn()
      .mockResolvedValueOnce({ mappings: [first], warnings: [] })
      .mockResolvedValueOnce({ mappings: [second], warnings: [] });
    const enrichUploadPage = vi.fn().mockResolvedValue(enrichmentWithFile('cached.flac'));

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: {
        resolveArtistCatalogPage: async () => ({ mappings: [], nextPageUrls: [], totalCount: 2, warnings: [] }),
        enrichUploadPage
      }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const more = await manager.loadMore(start.value.sessionId);

    expect(more.ok).toBe(true);
    if (!more.ok) return;
    expect(more.value.groups).toHaveLength(2);
    expect(enrichUploadPage).toHaveBeenCalledTimes(1);
  });

  it('bounds upload-page enrichment concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const apiPage = vi.fn().mockResolvedValue({
      mappings: Array.from({ length: 8 }, (_value, index) => makeMapping(String(index + 1), 'testArtist', [])),
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: {
        resolveArtistCatalogPage: async () => ({ mappings: [], nextPageUrls: [], totalCount: 8, warnings: [] }),
        enrichUploadPage: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(emptyEnrichment(), 20);
          active -= 1;
          return emptyEnrichment();
        }
      }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');

    expect(start.ok).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('cancels future enrichment while preserving already discovered files', async () => {
    const apiPage = vi.fn()
      .mockResolvedValueOnce({ mappings: [makeMapping('1', 'testArtist', [])], warnings: [] })
      .mockResolvedValueOnce({ mappings: [makeMapping('2', 'testArtist', []), makeMapping('3', 'testArtist', [])], warnings: [] });
    const enrichUploadPage = vi.fn().mockImplementation((sourceUrl: string) =>
      sourceUrl.endsWith('/1') ? Promise.resolve(enrichmentWithFile('first.flac')) : delay(enrichmentWithFile('late.flac'), 50)
    );

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: {
        resolveArtistCatalogPage: async () => ({ mappings: [], nextPageUrls: [], totalCount: 3, warnings: [] }),
        enrichUploadPage
      }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const loading = manager.loadMore(start.value.sessionId);
    const cancelled = manager.cancelSession(start.value.sessionId);
    const loaded = await loading;

    expect(cancelled.ok).toBe(true);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.scanPhase).toBe('cancelled');
    expect(loaded.value.groups).toHaveLength(1);
    expect(loaded.value.groups[0]?.files[0]?.originalFilename).toBe('first.flac');
  });

  it('returns first chunk with totalCount 96 from HTML info', async () => {
    const apiPage = vi.fn().mockResolvedValue(makePage(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']));
    const catalogPage = vi.fn().mockResolvedValue({
      mappings: [],
      nextPageUrls: [],
      totalCount: 96,
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: catalogPage }
    });

    const result = await manager.startSession('7OOP3D', 'https://ccmixter.org/people/7OOP3D');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loadedCount).toBe(12);
    expect(result.value.totalCount).toBe(96);
    expect(result.value.hasMore).toBe(true);
    expect(result.value.groups).toHaveLength(12);
  });

  it('appends unique rows on load-more', async () => {
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(['1', '2', '3']))
      .mockResolvedValueOnce(makePage(['4', '5', '6']));

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.loadedCount).toBe(3);

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;

    expect(more.value.loadedCount).toBe(6);
    expect(more.value.groups).toHaveLength(6);
  });

  it('does not duplicate rows on overlapping chunks', async () => {
    let callCount = 0;
    const apiPage = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve(makePage(['1', '2', '3']));
      if (callCount === 2) return Promise.resolve(makePage(['2', '3', '4']));
      return Promise.resolve({ mappings: [], warnings: [] });
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.loadedCount).toBe(3);

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;

    expect(more.value.loadedCount).toBe(4);
    expect(more.value.groups).toHaveLength(4);

    const groupIds = new Set(more.value.groups.map((g) => g.groupId));
    expect(groupIds.size).toBe(4);
  });

  it('prevents concurrent load-more storm', async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const apiPage = vi.fn().mockImplementation(async () => {
      concurrentCalls += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCalls -= 1;
      return makePage(['4', '5', '6']);
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const first = manager.loadMore(start.value.sessionId);
    const second = manager.loadMore(start.value.sessionId);
    const third = manager.loadMore(start.value.sessionId);

    const results = await Promise.all([first, second, third]);

    const okResults = results.filter((r) => r.ok);
    const skippedResults = results.filter((r) => !r.ok);
    expect(okResults.length).toBeGreaterThanOrEqual(1);
    expect(maxConcurrent).toBeLessThanOrEqual(1);
  });

  it('reaches end state when loadedCount reaches totalCount', async () => {
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(['1', '2', '3']))
      .mockResolvedValueOnce(makePage(['4', '5', '6']))
      .mockResolvedValueOnce(makePage(['7', '8']));

    const catalogPage = vi.fn().mockResolvedValue({
      mappings: [],
      nextPageUrls: [],
      totalCount: 8,
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: catalogPage }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.totalCount).toBe(8);

    const more1 = await manager.loadMore(start.value.sessionId);
    expect(more1.ok).toBe(true);
    if (!more1.ok) return;
    expect(more1.value.loadedCount).toBe(6);
    expect(more1.value.hasMore).toBe(true);

    const more2 = await manager.loadMore(start.value.sessionId);
    expect(more2.ok).toBe(true);
    if (!more2.ok) return;
    expect(more2.value.loadedCount).toBe(8);
    expect(more2.value.hasMore).toBe(false);
  });

  it('stops when no records returned', async () => {
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(['1', '2', '3']))
      .mockResolvedValueOnce({ mappings: [], warnings: [] });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;
    expect(more.value.loadedCount).toBe(3);
    expect(more.value.hasMore).toBe(false);
  });

  it('returns error for invalid session id', async () => {
    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: async () => ({ mappings: [], warnings: [] }),
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const result = await manager.loadMore('nonexistent-session');
    expect(result.ok).toBe(false);
  });

  it('falls back to HTML with totalCount and nextPageUrl when the API throws ERR_RESPONSE_HEADERS_TOO_BIG', async () => {
    const apiPage = vi.fn().mockRejectedValue(new Error('ccMixter API artist catalog request failed for https://ccmixter.org/api/query?f=json&dataview=default&user=7OOP3D&limit=12&offset=0: net::ERR_RESPONSE_HEADERS_TOO_BIG'));
    const htmlPage = vi.fn().mockResolvedValue({
      mappings: makePage(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']).mappings,
      nextPageUrls: ['https://ccmixter.org/people/7OOP3D?offset=12'],
      totalCount: 96,
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: htmlPage }
    });

    const start = await manager.startSession('7OOP3D', 'https://ccmixter.org/people/7OOP3D');

    expect(start.ok).toBe(true);
    if (!start.ok) return;

    expect(start.value.loadedCount).toBe(12);
    expect(start.value.totalCount).toBe(96);
    expect(start.value.hasMore).toBe(true);
    expect(start.value.warnings.some((warning) => warning.includes('net::ERR_RESPONSE_HEADERS_TOO_BIG'))).toBe(true);
    expect(start.value.warnings.some((warning) => warning.includes('HTML artist catalog fallback succeeded'))).toBe(true);

    // Subsequent paging must go through the HTML client, not the (already-failing) API client.
    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    expect(apiPage).toHaveBeenCalledTimes(1);
    expect(htmlPage).toHaveBeenCalledTimes(2);
  });

  it('races the API and HTML fallback so a fast HTML response wins without waiting for a slow API', async () => {
    const apiPage = vi.fn().mockImplementation(() => delayReject(new Error('net::ERR_RESPONSE_HEADERS_TOO_BIG'), 300));
    const htmlPage = vi.fn().mockImplementation(() =>
      delay(
        {
          mappings: makePage(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']).mappings,
          nextPageUrls: ['https://ccmixter.org/people/7OOP3D?offset=12'],
          totalCount: 96,
          warnings: []
        },
        10
      )
    );

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: htmlPage }
    });

    const startedAt = Date.now();
    const start = await manager.startSession('7OOP3D', 'https://ccmixter.org/people/7OOP3D');
    const elapsedMs = Date.now() - startedAt;

    expect(start.ok).toBe(true);
    if (!start.ok) return;

    expect(start.value.loadedCount).toBe(12);
    expect(start.value.totalCount).toBe(96);
    expect(start.value.hasMore).toBe(true);
    // The session must resolve well before the slow API call's 300ms delay elapses, proving the
    // HTML response actually won the race instead of the API being awaited first.
    expect(elapsedMs).toBeLessThan(150);
  });

  it('paginates an HTML-sourced session through multiple pages via nextPageUrl, deduping overlaps', async () => {
    const htmlPage = vi.fn()
      .mockResolvedValueOnce({
        mappings: makePage(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']).mappings,
        nextPageUrls: ['https://ccmixter.org/people/testArtist?offset=12'],
        totalCount: 25,
        warnings: []
      })
      .mockResolvedValueOnce({
        // Overlapping page: repeats upload '12' before introducing 13-24.
        mappings: makePage(['12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24']).mappings,
        nextPageUrls: ['https://ccmixter.org/people/testArtist?offset=24'],
        totalCount: 25,
        warnings: []
      })
      .mockResolvedValueOnce({
        mappings: makePage(['25']).mappings,
        nextPageUrls: [],
        totalCount: 25,
        warnings: []
      });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: vi.fn().mockRejectedValue(new Error('net::ERR_RESPONSE_HEADERS_TOO_BIG')),
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: htmlPage }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.loadedCount).toBe(12);
    expect(start.value.totalCount).toBe(25);
    expect(start.value.hasMore).toBe(true);

    const more1 = await manager.loadMore(start.value.sessionId);
    expect(more1.ok).toBe(true);
    if (!more1.ok) return;
    expect(more1.value.loadedCount).toBe(24);
    expect(more1.value.hasMore).toBe(true);

    const more2 = await manager.loadMore(start.value.sessionId);
    expect(more2.ok).toBe(true);
    if (!more2.ok) return;
    expect(more2.value.loadedCount).toBe(25);
    expect(more2.value.hasMore).toBe(false);

    const allIds = new Set(more2.value.groups.map((g) => g.groupId));
    expect(allIds.size).toBe(25);
  });

  it('does not silently complete on a duplicate-only page when totalCount says more remain, and marks pagingIncomplete after recovery fails', async () => {
    const firstIds = Array.from({ length: 240 }, (_, i) => String(i + 1));
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(firstIds))
      // Every subsequent page (regardless of offset) returns only ids already seen.
      .mockResolvedValue(makePage(['238', '239', '240']));

    const catalogPage = vi.fn().mockResolvedValue({
      mappings: [],
      nextPageUrls: [],
      totalCount: 553,
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: catalogPage }
    });

    const start = await manager.startSession('bigArtist', 'https://ccmixter.org/people/bigArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.loadedCount).toBe(240);
    expect(start.value.totalCount).toBe(553);

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;

    // Must not silently report completion: loadedCount is still well below totalCount.
    expect(more.value.loadedCount).toBe(240);
    expect(more.value.pagingIncomplete).toBe(true);
  });

  it('recovers from a duplicate-only API page by advancing the offset and continues loading', async () => {
    const firstIds = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(firstIds))
      // Offset 12: duplicate-only page.
      .mockResolvedValueOnce(makePage(firstIds))
      // Offset 24 (advanced by the observed page size): fresh ids.
      .mockResolvedValueOnce(makePage(['13', '14', '15']));

    const catalogPage = vi.fn().mockResolvedValue({
      mappings: [],
      nextPageUrls: [],
      totalCount: 100,
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: catalogPage }
    });

    const start = await manager.startSession('recoverArtist', 'https://ccmixter.org/people/recoverArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.loadedCount).toBe(12);

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;

    expect(more.value.loadedCount).toBe(15);
    expect(more.value.hasMore).toBe(true);
    expect(more.value.pagingIncomplete).toBe(false);
    expect(apiPage).toHaveBeenCalledTimes(3);
  });

  it('stops at max page guard', async () => {
    const pageWithOneItem = makePage(['1']);
    const apiPage = vi.fn().mockResolvedValue(pageWithOneItem);

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    let sessionId = start.value.sessionId;
    let iterations = 0;
    const maxIterations = 25;

    for (let i = 0; i < maxIterations; i++) {
      const more = await manager.loadMore(sessionId);
      expect(more.ok).toBe(true);
      if (!more.ok) break;
      sessionId = more.value.sessionId;
      iterations += 1;
      if (!more.value.hasMore) break;
    }

    expect(iterations).toBeGreaterThan(0);
    expect(iterations).toBeLessThanOrEqual(20);
  });
});

function enrichmentWithFile(filename: string): CcmixterHtmlEnrichment {
  return {
    sourceUrl: 'https://ccmixter.org/files/testArtist/1',
    tags: ['stems'],
    fileCandidates: [
      {
        label: filename,
        file: buildTrackFile(filename, `https://ccmixter.org/download/${filename}`, 'html-enriched')
      }
    ],
    zipFileHints: [],
    archiveHintGroups: [],
    relatedUploadUrls: [],
    warnings: []
  };
}

function emptyEnrichment(): CcmixterHtmlEnrichment {
  return {
    sourceUrl: 'https://ccmixter.org/files/testArtist/1',
    tags: [],
    fileCandidates: [],
    zipFileHints: [],
    archiveHintGroups: [],
    relatedUploadUrls: [],
    warnings: ['HTML enrichment did not find visible downloadable file candidates.']
  };
}
