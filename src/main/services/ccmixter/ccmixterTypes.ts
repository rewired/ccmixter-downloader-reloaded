import type { MetadataSourceType, TrackFile, TrackUpload } from '../../../shared/domain';

export type RawCcmixterApiUpload = Record<string, unknown>;

export interface CcmixterApiQuery {
  artistLogin?: string;
  uploadId?: string;
  dataview?: 'default' | 'info' | 'files';
  limit?: number;
  offset?: number;
}

export interface CcmixterApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CcmixterApiUploadMapping {
  upload: TrackUpload;
  files: TrackFile[];
  warnings: string[];
}

export interface CcmixterArtistCatalogResult {
  mappings: CcmixterApiUploadMapping[];
  pagingIncomplete: boolean;
  warnings: string[];
}

export interface CcmixterArtistCatalogPage {
  mappings: CcmixterApiUploadMapping[];
  totalCount?: number;
  warnings: string[];
}

export interface HtmlFileCandidate {
  file: TrackFile;
  label: string;
}

export interface CcmixterHtmlEnrichment {
  sourceUrl?: string;
  bpm?: number;
  tags: string[];
  licenseSummary?: string;
  fileCandidates: HtmlFileCandidate[];
  zipFileHints: string[];
  relatedUploadUrls: string[];
  warnings: string[];
}

export interface CcmixterHtmlCatalogResult {
  mappings: CcmixterApiUploadMapping[];
  nextPageUrls: string[];
  totalCount?: number;
  warnings: string[];
}

export interface CcmixterHtmlClientOptions {
  fetchImpl?: typeof fetch;
  // ccMixter's JSON query API (used by the download-action file lookup) echoes its entire response
  // payload into an "X-JSON" response header, which crashes Electron's net.fetch-backed fetch on any
  // non-Latin1 character. Callers that hit this should pass a net.request-backed implementation here
  // (see main/index.ts's electronJsonFetch); defaults to fetchImpl when not provided.
  jsonFetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ResolveCcmixterMetadataOptions {
  enrichHtml?: boolean;
}

export interface CcmixterResolverDependencies {
  apiClient: {
    resolveByArtistLogin(artistLogin: string): Promise<CcmixterArtistCatalogResult>;
    resolveByUploadId(uploadId: string): Promise<CcmixterApiUploadMapping[]>;
  };
  htmlClient?: {
    enrichUploadPage(sourceUrl: string): Promise<CcmixterHtmlEnrichment>;
    resolveArtistCatalogPage?(sourceUrl: string, artistLogin: string): Promise<CcmixterHtmlCatalogResult>;
  };
}
