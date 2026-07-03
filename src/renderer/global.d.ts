import type { CcmixterDownloaderApi } from '../shared/ipc';

declare global {
  interface Window {
    ccmixterDownloader: CcmixterDownloaderApi;
  }
}

export {};
