import { app, BrowserWindow, dialog, ipcMain, net, type OpenDialogOptions } from 'electron';
import path from 'path';

import {
  parseCcmixterInput,
  type AppError,
  type ArchivePreview,
  type ArtistCatalogPageResult,
  type ArtistCatalogState,
  type DownloadJob,
  type DownloadProgress,
  type DownloadQueueState,
  type DownloadResult,
  type DryRunPlan,
  type ResolvedCcmixterMetadata,
  type StemLibraryRoot
} from '../shared/domain';
import { IPC_CHANNELS, type AppInfo, type ChooseStemLibraryRootResult, type IpcResult } from '../shared/ipc';
import { ArchiveInspectionService } from './services/archive/archiveInspectionService';
import { ArtistCatalogSessionManager } from './services/ccmixter/artistCatalogSessionManager';
import { CcmixterApiClient } from './services/ccmixter/ccmixterApiClient';
import { CcmixterHtmlClient } from './services/ccmixter/ccmixterHtmlClient';
import { CcmixterResolver } from './services/ccmixter/ccmixterResolver';
import { DownloadManager } from './services/download/downloadManager';
import { SettingsStore } from './settings';

// Electron's net.fetch can surface certain lower-level networking failures (e.g. a legacy
// server sending a malformed response header) as an uncaught EventEmitter 'error' rather than
// a rejected fetch() promise, which bypasses our own try/catch in the ccMixter clients entirely.
// Log and keep the app alive instead of letting it crash with a blocking native dialog.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in main process:', reason);
});

let settingsStore: SettingsStore;
const electronFetch: typeof fetch = (input, init) => {
  const resolvedInput = input instanceof URL ? input.toString() : input;
  return net.fetch(resolvedInput as Parameters<typeof net.fetch>[0], init) as Promise<Response>;
};

// ccMixter's JSON query API echoes its entire (potentially large) response payload into a single
// "X-JSON" response header, in addition to the body. Electron's net.fetch bridges response headers
// through undici's strict WHATWG Headers implementation, which throws (as an uncaught exception,
// not a rejected promise — see the process-level handlers above) when a header value contains a
// non-Latin1 character, which is common in real upload titles/tags. net.request exposes response
// headers as plain Node-style values with no such validation, sidestepping the crash entirely, so
// the JSON API client uses it instead of net.fetch.
const electronJsonFetch: typeof fetch = (input, init) => {
  const url = input instanceof URL ? input.toString() : String(input);

  return new Promise((resolve, reject) => {
    const request = net.request({ method: init?.method ?? 'GET', url });

    for (const [name, value] of headerEntries(init?.headers)) {
      request.setHeader(name, value);
    }

    const signal = init?.signal;
    const onAbort = (): void => request.abort();

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(
          new Response(Buffer.concat(chunks), {
            status: response.statusCode,
            statusText: response.statusMessage
          })
        );
      });
      response.on('error', (error) => {
        signal?.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    request.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      } else {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    request.end();
  });
};

function headerEntries(headers: HeadersInit | undefined): Array<[string, string]> {
  if (!headers) {
    return [];
  }

  if (headers instanceof Headers) {
    return [...headers.entries()];
  }

  if (Array.isArray(headers)) {
    return headers;
  }

  return Object.entries(headers);
}

const apiClient = new CcmixterApiClient({ fetchImpl: electronJsonFetch });
const htmlClient = new CcmixterHtmlClient({ fetchImpl: electronFetch, jsonFetchImpl: electronJsonFetch });
const ccmixterResolver = new CcmixterResolver({
  apiClient,
  htmlClient
});
const catalogSessionManager = new ArtistCatalogSessionManager({
  apiClient,
  htmlClient
});
const archiveInspectionService = new ArchiveInspectionService();
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

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(app.getPath('userData'));
  await applyE2EStemLibraryRoot();
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
    const e2eRootPath = getE2EStemLibraryRootPath();
    if (e2eRootPath) {
      const root = await settingsStore.setStemLibraryRoot(e2eRootPath);
      return {
        cancelled: false,
        root
      };
    }

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

  ipcMain.handle(
    IPC_CHANNELS.artistCatalogStart,
    async (_event, artistLogin: string, sourceUrl?: string): Promise<IpcResult<ArtistCatalogState>> => {
      try {
        const result = await catalogSessionManager.startSession(artistLogin, sourceUrl);
        if (!result.ok) {
          return errorResult('ARTIST_CATALOG_START_FAILED', result.error, true);
        }
        return { ok: true, value: result.value };
      } catch (error) {
        return errorResult('ARTIST_CATALOG_START_FAILED', 'Artist catalog session could not be started.', true, error);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artistCatalogLoadMore,
    async (_event, sessionId: string): Promise<IpcResult<ArtistCatalogPageResult>> => {
      try {
        const result = await catalogSessionManager.loadMore(sessionId);
        if (!result.ok) {
          return errorResult('ARTIST_CATALOG_LOAD_MORE_FAILED', result.error, true);
        }
        return { ok: true, value: result.value };
      } catch (error) {
        return errorResult('ARTIST_CATALOG_LOAD_MORE_FAILED', 'Artist catalog could not load more uploads.', true, error);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artistCatalogCancel,
    async (_event, sessionId: string): Promise<IpcResult<ArtistCatalogPageResult>> => {
      try {
        const result = catalogSessionManager.cancelSession(sessionId);
        if (!result.ok) {
          return errorResult('ARTIST_CATALOG_CANCEL_FAILED', result.error, true);
        }
        return { ok: true, value: result.value };
      } catch (error) {
        return errorResult('ARTIST_CATALOG_CANCEL_FAILED', 'Artist catalog scan could not be cancelled.', true, error);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.previewArchiveDownload,
    async (_event, jobId: string, fileJobId: string): Promise<IpcResult<ArchivePreview>> => {
      try {
        const job = downloadManager.getJob(jobId);
        if (!job) {
          return errorResult('ARCHIVE_PREVIEW_JOB_NOT_FOUND', 'Download job was not found for archive preview.', true);
        }

        const file = job.files.find((candidate) => candidate.fileJobId === fileJobId);
        if (!file || file.fileKind !== 'archive') {
          return errorResult('ARCHIVE_PREVIEW_FILE_NOT_FOUND', 'Archive file was not found in the download job.', true);
        }

        const targetPath = resolveTargetPath(job.stemLibraryRootPath, file.targetRelativePath);
        return {
          ok: true,
          value: await archiveInspectionService.previewZipArchive(targetPath, path.dirname(targetPath))
        };
      } catch (error) {
        return errorResult(
          'ARCHIVE_PREVIEW_FAILED',
          'Archive preview could not be created. Download the ZIP first, then preview its contents.',
          true,
          error
        );
      }
    }
  );
}

async function applyE2EStemLibraryRoot(): Promise<void> {
  const e2eRootPath = getE2EStemLibraryRootPath();
  if (e2eRootPath) {
    await settingsStore.setStemLibraryRoot(e2eRootPath);
  }
}

function getE2EStemLibraryRootPath(): string | null {
  const e2eRootPath = process.env.CCMIXTER_E2E_ROOT;
  if (process.env.CCMIXTER_E2E !== '1' || !e2eRootPath || !isValidFolderPath(e2eRootPath)) {
    return null;
  }

  return e2eRootPath;
}

function isValidFolderPath(folderPath: string): boolean {
  return typeof folderPath === 'string' && folderPath.trim().length > 0 && path.isAbsolute(folderPath);
}

function resolveTargetPath(rootPath: string, targetRelativePath: string): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, targetRelativePath);
  const relative = path.relative(root, target);

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Archive preview target escapes the Stem Library Root Folder: ${targetRelativePath}`);
  }

  return target;
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
