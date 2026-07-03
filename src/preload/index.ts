import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppInfo,
  CcmixterDownloaderApi,
  ChooseStemLibraryRootResult,
  IpcResult
} from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';
import type { CcmixterInput, DryRunPlan, ResolvedCcmixterMetadata, StemLibraryRoot } from '../shared/domain';

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
    ipcRenderer.invoke(IPC_CHANNELS.createDryRunPlan, rawInput, rootFolder) as Promise<IpcResult<DryRunPlan>>
};

contextBridge.exposeInMainWorld('ccmixterDownloader', api);
