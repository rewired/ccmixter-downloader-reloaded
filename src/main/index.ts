import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import path from 'path';

import { createDryRunPlanFromFixture, parseCcmixterInput, type AppError, type StemLibraryRoot } from '../shared/domain';
import { IPC_CHANNELS, type AppInfo, type ChooseStemLibraryRootResult, type IpcResult } from '../shared/ipc';
import { SAMPLE_STEM_GROUPS } from './sample-data';
import { SettingsStore } from './settings';

let settingsStore: SettingsStore;

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

  ipcMain.handle(
    IPC_CHANNELS.createDryRunPlan,
    (_event, rawInput: string, rootFolder: StemLibraryRoot | null): IpcResult<ReturnType<typeof createDryRunPlanFromFixture>> => {
      if (!rootFolder || !isValidFolderPath(rootFolder.path)) {
        return errorResult(
          'STEM_LIBRARY_ROOT_REQUIRED',
          'Choose a Stem Library Root Folder before creating a dry run.',
          true
        );
      }

      return {
        ok: true,
        value: createDryRunPlanFromFixture(rawInput, rootFolder, SAMPLE_STEM_GROUPS)
      };
    }
  );
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
