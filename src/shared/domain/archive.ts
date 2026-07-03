export type ArchiveEntryType = 'file' | 'directory' | 'unknown';

export interface ArchiveExtractionWarning {
  code: string;
  message: string;
  blocking: boolean;
  entryPath?: string;
}

export interface ArchiveEntryPreview {
  originalPath: string;
  targetRelativePath: string | null;
  type: ArchiveEntryType;
  sizeBytes?: number;
  extension?: string;
  blocked: boolean;
  warnings: ArchiveExtractionWarning[];
  reasons: string[];
}

export interface ArchiveExtractionPlan {
  destinationRootPath: string;
  entries: ArchiveEntryPreview[];
  plannedPaths: string[];
  warnings: ArchiveExtractionWarning[];
  safeToExtract: boolean;
  extractionImplemented: false;
}

export interface ArchivePreview {
  archivePath: string;
  format: 'zip';
  entryCount: number;
  entries: ArchiveEntryPreview[];
  warnings: ArchiveExtractionWarning[];
  extractionPlan: ArchiveExtractionPlan;
  safeToExtract: boolean;
  createdAt: string;
}
