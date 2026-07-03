import { app, BrowserWindow, dialog, ipcMain, net, type OpenDialogOptions } from 'electron';
import path from 'path';

import {
  parseCcmixterInput,
  type AppError,
  type DownloadJob,
  type DownloadProgress,
  type DownloadQueueState,
  type DownloadResult,
  type DryRunPlan,
  type ResolvedCcmixterMetadata,
  type StemLibraryRoot
} from '../shared/domain';
import { IPC_CHANNELS, type AppInfo, type ChooseStemLibraryRootResult, type IpcResult } from '../shared/ipc';
import { CcmixterResolver } from './services/ccmixter/ccmixterResolver';
import { DownloadManager } from './services/download/downloadManager';
import { SettingsStore } from './settings';

let settingsStore: SettingsStore;
const ccmixterResolver = new CcmixterResolver();
const downloadManager = new DownloadManager({
  fetcher: (url, options) => net.fetch(url, options),
  onProgress: (progress) => broadcastToRenderer(IPC_CHANNELS.downloadProgress, progress),
  onCompleted: (result) => broadcastToRenderer(IPC_CHANNELS.downloadCompleted, result)
});

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    title: 'ccMixter Stem Downloader',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
};

app.whenReady().then(() => {
  settingsStore = new SettingsStore(app.getPath('userData'));
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (): AppInfo => ({
    name: 'ccMixter Stem Downloader',
    version: app.getVersion()
  }));

  ipcMain.handle(IPC_CHANNELS.chooseStemLibraryRoot, async (): Promise<ChooseStemLibraryRootResult> => {
    const focusedWindow = BrowserWindow.getFocusedWindow() ?? undefined;
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose Stem Library Root Folder',
      properties: ['openDirectory', 'createDirectory']
    };
    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    const selectedPath = result.filePaths[0];

    if (result.canceled || !selectedPath) {
      return {
        cancelled: true,
        root: null
      };
    }

    const root = await settingsStore.setStemLibraryRoot(selectedPath);
    return {
      cancelled: false,
      root
    };
  });

  ipcMain.handle(IPC_CHANNELS.getStemLibraryRoot, async (): Promise<StemLibraryRoot | null> => {
    return settingsStore.getStemLibraryRoot();
  });

  ipcMain.handle(IPC_CHANNELS.setStemLibraryRoot, async (_event, folderPath: string): Promise<IpcResult<StemLibraryRoot>> => {
    if (!isValidFolderPath(folderPath)) {
      return errorResult('INVALID_STEM_LIBRARY_ROOT', 'Choose a non-empty absolute Stem Library Root Folder.', true);
    }

    try {
      const root = await settingsStore.setStemLibraryRoot(folderPath);
      return {
        ok: true,
        value: root
      };
    } catch (error) {
      return errorResult('STEM_LIBRARY_ROOT_WRITE_FAILED', 'The Stem Library Root Folder setting could not be saved.', true, error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.parseInput, (_event, rawInput: string) => parseCcmixterInput(rawInput));

  ipcMain.handle(IPC_CHANNELS.resolveMetadata, async (_event, rawInput: string): Promise<IpcResult<ResolvedCcmixterMetadata>> => {
    try {
      return {
        ok: true,
        value: await ccmixterResolver.resolveMetadata(rawInput)
      };
    } catch (error) {
      return errorResult('CCMIXTER_METADATA_RESOLVE_FAILED', 'ccMixter metadata could not be resolved.', true, error);
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.createDryRunPlan,
    async (_event, rawInput: string, rootFolder: StemLibraryRoot | null): Promise<IpcResult<DryRunPlan>> => {
      if (!rootFolder || !isValidFolderPath(rootFolder.path)) {
        return errorResult(
          'STEM_LIBRARY_ROOT_REQUIRED',
          'Choose a Stem Library Root Folder before creating a dry run.',
          true
        );
      }

      try {
        return {
          ok: true,
          value: await ccmixterResolver.createDryRunPlan(rawInput, rootFolder)
        };
      } catch (error) {
        return errorResult('CCMIXTER_DRY_RUN_FAILED', 'Dry-run metadata planning failed.', true, error);
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.createDownloadJob, async (_event, reviewedPlan: DryRunPlan): Promise<IpcResult<DownloadJob>> => {
    try {
      const persistedRoot = await settingsStore.getStemLibraryRoot();
      if (!persistedRoot || persistedRoot.path !== reviewedPlan.stemLibraryRoot.path) {
        return errorResult(
          'STEM_LIBRARY_ROOT_MISMATCH',
          'The reviewed plan does not match the selected Stem Library Root Folder.',
          true
        );
      }

      return {
        ok: true,
        value: await downloadManager.createJobFromReviewedPlan(reviewedPlan)
      };
    } catch (error) {
      return errorResult('DOWNLOAD_JOB_CREATE_FAILED', 'Download job could not be created.', true, error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.startDownloadJob, async (_event, jobId: string): Promise<IpcResult<DownloadQueueState>> => {
    try {
      return {
        ok: true,
        value: await downloadManager.startDownloadJob(jobId)
      };
    } catch (error) {
      return errorResult('DOWNLOAD_JOB_START_FAILED', 'Download job could not be started.', true, error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.cancelDownloadJob, async (_event, jobId: string): Promise<IpcResult<DownloadQueueState>> => {
    try {
      return {
        ok: true,
        value: await downloadManager.cancelDownloadJob(jobId)
      };
    } catch (error) {
      return errorResult('DOWNLOAD_JOB_CANCEL_FAILED', 'Download job could not be cancelled.', true, error);
    }
  });
}

function isValidFolderPath(folderPath: string): boolean {
  return typeof folderPath === 'string' && folderPath.trim().length > 0 && path.isAbsolute(folderPath);
}

function errorResult<T>(code: string, message: string, recoverable: boolean, error?: unknown): IpcResult<T> {
  const appError: AppError = {
    code,
    message,
    recoverable,
    technicalDetail: error instanceof Error ? error.message : undefined
  };

  return {
    ok: false,
    error: appError
  };
}

function broadcastToRenderer(channel: typeof IPC_CHANNELS.downloadProgress, payload: DownloadProgress): void;
function broadcastToRenderer(channel: typeof IPC_CHANNELS.downloadCompleted, payload: DownloadResult): void;
function broadcastToRenderer(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}
