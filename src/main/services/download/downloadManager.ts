import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';

import {
  createDownloadJobFromReviewedPlan,
  isAllowedCcmixterHostname,
  summarizeDownloadJob,
  validateCcmixterDownloadUrl,
  validateDownloadJob,
  type DownloadError,
  type DownloadFileJob,
  type DownloadFileState,
  type DownloadJob,
  type DownloadProgress,
  type DownloadQueueState,
  type DownloadResult,
  type DownloadStatus,
  type DryRunPlan
} from '../../../shared/domain';
import type { DownloadFetcher, DownloadFetcherResponse, DownloadManagerOptions } from './downloadTypes';

const DEFAULT_MAX_REDIRECTS = 5;

interface ActiveDownload {
  controller: AbortController;
  tempPath?: string;
}

export class DownloadManager {
  private readonly fetcher: DownloadFetcher;
  private readonly maxRedirects: number;
  private readonly onProgress?: (progress: DownloadProgress) => void;
  private readonly onCompleted?: (result: DownloadResult) => void;
  private readonly jobs = new Map<string, DownloadJob>();
  private readonly activeDownloads = new Map<string, ActiveDownload>();

  constructor(options: DownloadManagerOptions = {}) {
    this.fetcher = options.fetcher ?? (fetch as unknown as DownloadFetcher);
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.onProgress = options.onProgress;
    this.onCompleted = options.onCompleted;
  }

  async createJobFromReviewedPlan(plan: DryRunPlan): Promise<DownloadJob> {
    const preliminaryJob = createDownloadJobFromReviewedPlan(plan);
    const existingTargetRelativePaths = await this.findExistingTargets(preliminaryJob);
    const job = createDownloadJobFromReviewedPlan(plan, {
      jobId: preliminaryJob.jobId,
      createdAt: preliminaryJob.createdAt,
      existingTargetRelativePaths
    });
    const trustedJob = this.withTrustedTargetPaths(job);
    const validation = validateDownloadJob(trustedJob);
    const finalJob: DownloadJob = {
      ...trustedJob,
      status: validation.ok ? 'queued' : 'failed',
      warnings: validation.warnings,
      errors: validation.blockingErrors
    };

    this.jobs.set(finalJob.jobId, finalJob);
    return finalJob;
  }

  getJob(jobId: string): DownloadJob | undefined {
    return this.jobs.get(jobId);
  }

  async startDownloadJob(jobId: string): Promise<DownloadQueueState> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Download job was not found: ${jobId}`);
    }

    const trustedJob = this.withTrustedTargetPaths(job);
    const validation = validateDownloadJob(trustedJob);
    if (!validation.ok) {
      const failedJob = this.updateJob({
        ...trustedJob,
        status: 'failed',
        warnings: validation.warnings,
        errors: validation.blockingErrors
      });
      const state = toQueueState(failedJob);
      this.emitProgress(state);
      this.emitCompleted(failedJob);
      return state;
    }

    const rootError = await this.checkRootAvailable(trustedJob.stemLibraryRootPath);
    if (rootError) {
      const failedJob = this.updateJob({
        ...trustedJob,
        status: 'failed',
        errors: [...trustedJob.errors, rootError]
      });
      const state = toQueueState(failedJob);
      this.emitProgress(state);
      this.emitCompleted(failedJob);
      return state;
    }

    const existingTargetRelativePaths = await this.findExistingTargets(trustedJob);
    if (existingTargetRelativePaths.length > 0) {
      const failedJob = this.updateJob({
        ...trustedJob,
        status: 'failed',
        errors: [
          ...trustedJob.errors,
          ...existingTargetRelativePaths.map((target) =>
            downloadError('DOWNLOAD_TARGET_EXISTS', `Target already exists and overwrite is disabled: ${target}`, true)
          )
        ]
      });
      const state = toQueueState(failedJob);
      this.emitProgress(state);
      this.emitCompleted(failedJob);
      return state;
    }

    let runningJob = this.updateJob({ ...trustedJob, status: 'running' });
    this.emitProgress(toQueueState(runningJob));

    for (const file of runningJob.files) {
      if (this.isCancelled(jobId)) {
        runningJob = this.cancelQueuedFiles(runningJob);
        break;
      }

      if (file.status === 'skipped') {
        continue;
      }

      runningJob = this.updateFile(runningJob, file.fileJobId, {
        status: 'running',
        receivedBytes: 0
      });
      this.emitProgress(toQueueState(runningJob, file.fileJobId));

      const controller = new AbortController();
      this.activeDownloads.set(jobId, { controller });

      try {
        runningJob = await this.downloadFile(runningJob, file.fileJobId, controller);
      } catch (error) {
        if (controller.signal.aborted) {
          runningJob = this.updateFile(runningJob, file.fileJobId, {
            status: 'cancelled',
            errors: [downloadError('DOWNLOAD_CANCELLED', 'Download was cancelled.', true)]
          });
          runningJob = this.cancelQueuedFiles(runningJob);
          break;
        }

        runningJob = this.updateFile(runningJob, file.fileJobId, {
          status: 'failed',
          errors: [toDownloadError(error)]
        });
      } finally {
        this.activeDownloads.delete(jobId);
      }

      this.emitProgress(toQueueState(runningJob, file.fileJobId));
    }

    runningJob = this.updateJob({
      ...runningJob,
      status: resolveJobStatus(runningJob.files)
    });
    const state = toQueueState(runningJob);
    this.emitProgress(state);
    this.emitCompleted(runningJob);
    return state;
  }

  async cancelDownloadJob(jobId: string): Promise<DownloadQueueState> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Download job was not found: ${jobId}`);
    }

    const active = this.activeDownloads.get(jobId);
    active?.controller.abort();

    let cancelledJob = this.cancelQueuedFiles({
      ...job,
      status: 'cancelled'
    });

    const runningFile = cancelledJob.files.find((file) => file.status === 'running');
    if (runningFile) {
      const cleanupWarnings = active?.tempPath ? await this.removeTempFile(active.tempPath) : [];
      cancelledJob = this.updateFile(cancelledJob, runningFile.fileJobId, {
        status: 'cancelled',
        warnings: [...runningFile.warnings, ...cleanupWarnings],
        errors: [downloadError('DOWNLOAD_CANCELLED', 'Download was cancelled.', true)]
      });
    }

    cancelledJob = this.updateJob(cancelledJob);
    const state = toQueueState(cancelledJob);
    this.emitProgress(state);
    return state;
  }

  private async downloadFile(job: DownloadJob, fileJobId: string, controller: AbortController): Promise<DownloadJob> {
    const file = job.files.find((candidate) => candidate.fileJobId === fileJobId);
    if (!file) {
      throw new Error(`Download file job was not found: ${fileJobId}`);
    }

    if (!file.sourceUrl) {
      return this.updateFile(job, file.fileJobId, {
        status: 'skipped',
        errors: [downloadError('DOWNLOAD_URL_MISSING', 'File has no download URL.', true)]
      });
    }

    const response = await this.fetchAllowedResponse(file.sourceUrl, controller.signal);
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`);
    }

    const totalBytes = parseContentLength(response.headers.get('content-length'));
    const finalPath = this.resolveTargetPath(job.stemLibraryRootPath, file.targetRelativePath);
    const tempPath = this.createTempPath(finalPath, job.jobId, file.fileJobId);
    const active = this.activeDownloads.get(job.jobId);
    if (active) {
      active.tempPath = tempPath;
    }

    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await assertDoesNotExist(finalPath);

    let receivedBytes = 0;
    try {
      await this.writeResponseToTempFile(response, tempPath, async (chunkLength) => {
        receivedBytes += chunkLength;
        const nextJob = this.updateFile(this.jobs.get(job.jobId) ?? job, file.fileJobId, {
          status: 'running',
          receivedBytes,
          totalBytes
        });
        this.emitProgress(toQueueState(nextJob, file.fileJobId));
      });

      await assertDoesNotExist(finalPath);
      await fs.rename(tempPath, finalPath);

      return this.updateFile(this.jobs.get(job.jobId) ?? job, file.fileJobId, {
        status: 'completed',
        receivedBytes,
        totalBytes
      });
    } catch (error) {
      const cleanupWarnings = await this.removeTempFile(tempPath);
      if (controller.signal.aborted) {
        return this.updateFile(this.jobs.get(job.jobId) ?? job, file.fileJobId, {
          status: 'cancelled',
          receivedBytes,
          totalBytes,
          warnings: [...file.warnings, ...cleanupWarnings],
          errors: [downloadError('DOWNLOAD_CANCELLED', 'Download was cancelled.', true)]
        });
      }

      throw cleanupWarnings.length > 0
        ? new Error(`${error instanceof Error ? error.message : 'Download failed.'} ${cleanupWarnings.join(' ')}`)
        : error;
    }
  }

  private async fetchAllowedResponse(sourceUrl: string, signal: AbortSignal): Promise<DownloadFetcherResponse> {
    let currentUrl = sourceUrl;

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      const urlResult = validateCcmixterDownloadUrl(currentUrl);
      if (urlResult.errors.length > 0) {
        throw new Error(urlResult.errors[0]!.message);
      }

      const response = await this.fetcher(currentUrl, {
        signal,
        redirect: 'manual',
        headers: createCcmixterDownloadHeaders(currentUrl)
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response did not include a Location header for ${currentUrl}.`);
        }

        const nextUrl = new URL(location, currentUrl);
        if (!isAllowedCcmixterHostname(nextUrl.hostname)) {
          throw new Error(`Redirect target host is not allowed: ${nextUrl.hostname}`);
        }

        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
          throw new Error(`Redirect target protocol is not allowed: ${nextUrl.protocol}`);
        }

        currentUrl = nextUrl.toString();
        continue;
      }

      return response;
    }

    throw new Error(`Download exceeded ${this.maxRedirects} redirects.`);
  }

  private async writeResponseToTempFile(
    response: DownloadFetcherResponse,
    tempPath: string,
    onChunk: (chunkLength: number) => Promise<void>
  ): Promise<void> {
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    const handle = await fs.open(tempPath, 'wx');

    try {
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const result = await reader.read();
          if (result.done) {
            break;
          }

          await handle.write(Buffer.from(result.value));
          await onChunk(result.value.byteLength);
        }
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await handle.write(buffer);
      await onChunk(buffer.byteLength);
    } finally {
      await handle.close();
    }
  }

  private withTrustedTargetPaths(job: DownloadJob): DownloadJob {
    return {
      ...job,
      files: job.files.map((file) => ({
        ...file,
        targetAbsolutePath: this.resolveTargetPath(job.stemLibraryRootPath, file.targetRelativePath)
      }))
    };
  }

  private async checkRootAvailable(rootPath: string): Promise<DownloadError | undefined> {
    try {
      await fs.mkdir(rootPath, { recursive: true });
      await fs.access(rootPath, fsConstants.W_OK);
      return undefined;
    } catch {
      return downloadError(
        'DOWNLOAD_ROOT_UNAVAILABLE',
        'Download folder is not reachable or writable. Choose another folder.',
        true
      );
    }
  }

  private async findExistingTargets(job: DownloadJob): Promise<string[]> {
    const existingTargets: string[] = [];

    await Promise.all(
      job.files
        .filter((file) => file.status !== 'skipped')
        .map(async (file) => {
          const targetPath = this.resolveTargetPath(job.stemLibraryRootPath, file.targetRelativePath);
          if (await pathExists(targetPath)) {
            existingTargets.push(file.targetRelativePath);
          }
        })
    );

    return existingTargets;
  }

  private resolveTargetPath(rootPath: string, targetRelativePath: string): string {
    const root = path.resolve(rootPath);
    const target = path.resolve(root, targetRelativePath);
    const relative = path.relative(root, target);

    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Download target escapes the Stem Library Root Folder: ${targetRelativePath}`);
    }

    return target;
  }

  private createTempPath(finalPath: string, jobId: string, fileJobId: string): string {
    const safeId = `${jobId}-${fileJobId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const tempPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${safeId}.tmp`);
    const root = path.resolve(this.jobs.get(jobId)?.stemLibraryRootPath ?? path.dirname(finalPath));
    const relative = path.relative(root, tempPath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Temporary download path escapes the Stem Library Root Folder: ${tempPath}`);
    }

    return tempPath;
  }

  private async removeTempFile(tempPath: string): Promise<string[]> {
    try {
      await fs.rm(tempPath, { force: true });
      return [];
    } catch (error) {
      return [`Temporary file cleanup failed for ${tempPath}: ${error instanceof Error ? error.message : 'unknown error'}`];
    }
  }

  private updateFile(job: DownloadJob, fileJobId: string, updates: Partial<DownloadFileJob>): DownloadJob {
    return this.updateJob({
      ...job,
      files: job.files.map((file) =>
        file.fileJobId === fileJobId
          ? {
              ...file,
              ...updates,
              warnings: updates.warnings ?? file.warnings,
              errors: updates.errors ?? file.errors
            }
          : file
      )
    });
  }

  private updateJob(job: DownloadJob): DownloadJob {
    this.jobs.set(job.jobId, job);
    return job;
  }

  private cancelQueuedFiles(job: DownloadJob): DownloadJob {
    return {
      ...job,
      status: 'cancelled',
      files: job.files.map((file) => (file.status === 'queued' ? { ...file, status: 'cancelled' } : file))
    };
  }

  private isCancelled(jobId: string): boolean {
    return this.jobs.get(jobId)?.status === 'cancelled';
  }

  private emitProgress(state: DownloadQueueState): void {
    this.onProgress?.(state.progress);
  }

  private emitCompleted(job: DownloadJob): void {
    this.onCompleted?.(toDownloadResult(job));
  }
}

function toQueueState(job: DownloadJob, activeFileJobId?: string): DownloadQueueState {
  const files = job.files.map(toFileState);
  const totalFiles = files.filter((file) => file.status !== 'skipped' && file.status !== 'blocked').length;
  const completedFiles = files.filter((file) => file.status === 'completed').length;
  const skippedFiles = files.filter((file) => file.status === 'skipped').length;
  const blockedFiles = files.filter((file) => file.status === 'blocked').length;
  const failedFiles = files.filter((file) => file.status === 'failed').length;
  const activeFile = activeFileJobId ? files.find((file) => file.fileJobId === activeFileJobId) : undefined;
  const summary = summarizeDownloadJob(job);
  const progress: DownloadProgress = {
    jobId: job.jobId,
    fileJobId: activeFileJobId,
    status: job.status,
    receivedBytes: activeFile?.receivedBytes,
    totalBytes: activeFile?.totalBytes,
    completedFiles,
    totalFiles,
    skippedFiles,
    blockedFiles,
    failedFiles,
    warnings: summary.warnings,
    errors: summary.errors
  };

  return {
    jobId: job.jobId,
    status: job.status,
    files,
    progress,
    warnings: summary.warnings,
    errors: summary.errors
  };
}

function toFileState(file: DownloadFileJob): DownloadFileState {
  return {
    fileJobId: file.fileJobId,
    targetRelativePath: file.targetRelativePath,
    status: file.status,
    receivedBytes: file.receivedBytes,
    totalBytes: file.totalBytes,
    warnings: file.warnings,
    errors: file.errors
  };
}

function toDownloadResult(job: DownloadJob): DownloadResult {
  const files = job.files;
  const summary = summarizeDownloadJob(job);
  return {
    jobId: job.jobId,
    status: job.status,
    completedFiles: files.filter((file) => file.status === 'completed').length,
    skippedFiles: files.filter((file) => file.status === 'skipped').length,
    failedFiles: files.filter((file) => file.status === 'failed' || file.status === 'blocked').length,
    cancelledFiles: files.filter((file) => file.status === 'cancelled').length,
    warnings: summary.warnings,
    errors: summary.errors
  };
}

function resolveJobStatus(files: DownloadFileJob[]): DownloadStatus {
  if (files.some((file) => file.status === 'cancelled')) {
    return 'cancelled';
  }

  if (files.some((file) => file.status === 'failed')) {
    return 'failed';
  }

  if (files.some((file) => file.status === 'blocked')) {
    return 'failed';
  }

  return 'completed';
}

async function assertDoesNotExist(targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    throw new Error(`Target already exists and overwrite is disabled: ${targetPath}`);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function createCcmixterDownloadHeaders(sourceUrl: string): Record<string, string> {
  const url = new URL(sourceUrl);

  return {
    'User-Agent': 'Mozilla/5.0 (ccMixter Stem Downloader)',
    Referer: `${url.protocol}//${url.hostname}/`
  };
}

function toDownloadError(error: unknown): DownloadError {
  return downloadError('DOWNLOAD_FAILED', error instanceof Error ? error.message : 'Download failed.', true);
}

function downloadError(code: string, message: string, recoverable: boolean, technicalDetail?: string): DownloadError {
  return {
    code,
    message,
    recoverable,
    technicalDetail
  };
}
