import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppInfo,
  CcmixterDownloaderApi,
  ChooseStemLibraryRootResult,
  IpcResult
} from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';
import type {
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
} from '../shared/domain';

const api: CcmixterDownloaderApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo) as Promise<AppInfo>,
  chooseStemLibraryRoot: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseStemLibraryRoot) as Promise<ChooseStemLibraryRootResult>,
  getStemLibraryRoot: () => ipcRenderer.invoke(IPC_CHANNELS.getStemLibraryRoot) as Promise<StemLibraryRoot | null>,
  setStemLibraryRoot: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.setStemLibraryRoot, path) as Promise<IpcResult<StemLibraryRoot>>,
  parseInput: (rawInput: string) => ipcRenderer.invoke(IPC_CHANNELS.parseInput, rawInput) as Promise<CcmixterInput>,
  resolveMetadata: (rawInput: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveMetadata, rawInput) as Promise<IpcResult<ResolvedCcmixterMetadata>>,
  createDryRunPlan: (rawInput: string, rootFolder: StemLibraryRoot | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.createDryRunPlan, rawInput, rootFolder) as Promise<IpcResult<DryRunPlan>>,
  createDownloadJob: (reviewedPlan: DryRunPlan) =>
    ipcRenderer.invoke(IPC_CHANNELS.createDownloadJob, reviewedPlan) as Promise<IpcResult<DownloadJob>>,
  startDownloadJob: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.startDownloadJob, jobId) as Promise<IpcResult<DownloadQueueState>>,
  cancelDownloadJob: (jobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelDownloadJob, jobId) as Promise<IpcResult<DownloadQueueState>>,
  previewArchiveDownload: (jobId: string, fileJobId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewArchiveDownload, jobId, fileJobId) as Promise<IpcResult<ArchivePreview>>,
  artistCatalogStart: (artistLogin: string, sourceUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.artistCatalogStart, artistLogin, sourceUrl) as Promise<IpcResult<ArtistCatalogState>>,
  artistCatalogLoadMore: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.artistCatalogLoadMore, sessionId) as Promise<IpcResult<ArtistCatalogPageResult>>,
  artistCatalogCancel: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.artistCatalogCancel, sessionId) as Promise<IpcResult<ArtistCatalogPageResult>>,
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress): void => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.downloadProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.downloadProgress, listener);
  },
  onDownloadCompleted: (callback: (result: DownloadResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: DownloadResult): void => callback(result);
    ipcRenderer.on(IPC_CHANNELS.downloadCompleted, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.downloadCompleted, listener);
  }
};

contextBridge.exposeInMainWorld('ccmixterDownloader', api);
