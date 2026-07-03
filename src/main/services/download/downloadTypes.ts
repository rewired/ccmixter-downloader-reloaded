import type { DownloadJob, DownloadProgress, DownloadQueueState, DownloadResult } from '../../../shared/domain';

export interface DownloadManagerEvents {
  progress: DownloadProgress;
  completed: DownloadResult;
}

export interface DownloadFetcherOptions {
  signal: AbortSignal;
  redirect: 'manual';
}

export interface DownloadFetcherResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  url: string;
  headers: {
    get(name: string): string | null;
  };
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type DownloadFetcher = (url: string, options: DownloadFetcherOptions) => Promise<DownloadFetcherResponse>;

export interface DownloadManagerOptions {
  fetcher?: DownloadFetcher;
  maxRedirects?: number;
  onProgress?: (progress: DownloadProgress) => void;
  onCompleted?: (result: DownloadResult) => void;
}

export interface StoredDownloadJob {
  job: DownloadJob;
  state: DownloadQueueState;
}
