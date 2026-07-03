import type { MetadataSourceType, TrackFile, TrackUpload } from '../../../shared/domain';

export type RawCcmixterApiUpload = Record<string, unknown>;

export interface CcmixterApiQuery {
  artistLogin?: string;
  uploadId?: string;
  dataview?: 'info' | 'files';
  limit?: number;
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

export interface CcmixterHtmlClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ResolveCcmixterMetadataOptions {
  enrichHtml?: boolean;
}

export interface CcmixterResolverDependencies {
  apiClient: {
    resolveByArtistLogin(artistLogin: string): Promise<CcmixterApiUploadMapping[]>;
    resolveByUploadId(uploadId: string): Promise<CcmixterApiUploadMapping[]>;
  };
  htmlClient?: {
    enrichUploadPage(sourceUrl: string): Promise<CcmixterHtmlEnrichment>;
  };
}
