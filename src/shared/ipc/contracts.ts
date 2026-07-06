import type {
  AppError,
  ArchivePreview,
  ArtistCatalogPageResult,
  ArtistCatalogState,
  CcmixterInput,
  DownloadJob,
  DownloadProgress,
  DownloadQueueState,
  DownloadResult,
  DryRunPlan,
  ResolvedCcmixterMetadata,
  StemLibraryRoot
} from '../domain';

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  chooseStemLibraryRoot: 'stem-library:choose-root',
  getStemLibraryRoot: 'stem-library:get-root',
  setStemLibraryRoot: 'stem-library:set-root',
  parseInput: 'ccmixter:parse-input',
  resolveMetadata: 'ccmixter:resolve-metadata',
  createDryRunPlan: 'ccmixter:create-dry-run-plan',
  createDownloadJob: 'download:create-job',
  startDownloadJob: 'download:start-job',
  cancelDownloadJob: 'download:cancel-job',
  previewArchiveDownload: 'archive:preview-download',
  downloadProgress: 'download:progress',
  downloadCompleted: 'download:completed',
  artistCatalogStart: 'ccmixter:artist-catalog-start',
  artistCatalogLoadMore: 'ccmixter:artist-catalog-load-more',
  artistCatalogCancel: 'ccmixter:artist-catalog-cancel'
} as const;

export interface AppInfo {
  name: string;
  version: string;
}

export interface ChooseStemLibraryRootResult {
  cancelled: boolean;
  root: StemLibraryRoot | null;
}

export type IpcResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: AppError;
    };

export interface CcmixterDownloaderApi {
  getAppInfo(): Promise<AppInfo>;
  chooseStemLibraryRoot(): Promise<ChooseStemLibraryRootResult>;
  getStemLibraryRoot(): Promise<StemLibraryRoot | null>;
  setStemLibraryRoot(path: string): Promise<IpcResult<StemLibraryRoot>>;
  parseInput(rawInput: string): Promise<CcmixterInput>;
  resolveMetadata(rawInput: string): Promise<IpcResult<ResolvedCcmixterMetadata>>;
  createDryRunPlan(rawInput: string, rootFolder: StemLibraryRoot | null): Promise<IpcResult<DryRunPlan>>;
  createDownloadJob(reviewedPlan: DryRunPlan): Promise<IpcResult<DownloadJob>>;
  startDownloadJob(jobId: string): Promise<IpcResult<DownloadQueueState>>;
  cancelDownloadJob(jobId: string): Promise<IpcResult<DownloadQueueState>>;
  previewArchiveDownload(jobId: string, fileJobId: string): Promise<IpcResult<ArchivePreview>>;
  artistCatalogStart(artistLogin: string, sourceUrl?: string): Promise<IpcResult<ArtistCatalogState>>;
  artistCatalogLoadMore(sessionId: string): Promise<IpcResult<ArtistCatalogPageResult>>;
  artistCatalogCancel(sessionId: string): Promise<IpcResult<ArtistCatalogPageResult>>;
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
  onDownloadCompleted(callback: (result: DownloadResult) => void): () => void;
}
