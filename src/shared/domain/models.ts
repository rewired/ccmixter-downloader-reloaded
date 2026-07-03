export type CcmixterInputKind =
  | 'artist-link'
  | 'upload-link'
  | 'upload-id'
  | 'artist-name'
  | 'unknown';

export interface CcmixterInput {
  raw: string;
  kind: CcmixterInputKind;
  normalizedArtistLogin?: string;
  uploadId?: string;
  sourceUrl?: string;
  warnings: string[];
}

export interface StemLibraryRoot {
  path: string;
  selectedAt: string;
}

export interface TrackUpload {
  uploadId: string;
  artistName: string;
  artistLogin: string;
  title: string;
  bpm?: number;
  tags: string[];
  licenseSummary: string;
  sourceUrl: string;
  warnings: string[];
}

export type TrackFileKind = 'stem' | 'preview' | 'archive' | 'unknown';

export interface TrackFile {
  originalFilename: string;
  fileKind: TrackFileKind;
  extension: string;
  sizeBytes?: number;
  downloadUrl?: string;
  qualityHint?: string;
  warnings: string[];
}

export type Confidence = 'high' | 'medium' | 'low';

export interface StemGroup {
  groupId: string;
  artist: string;
  canonicalSongTitle: string;
  bpm?: number;
  uploads: TrackUpload[];
  files: TrackFile[];
  confidence: Confidence;
  warnings: string[];
}

export type ConflictStatus = 'not-checked' | 'available' | 'conflict';

export interface PlannedFile {
  sourceFile: TrackFile;
  targetRelativePath: string;
  targetAbsolutePath?: string;
  conflictStatus: ConflictStatus;
  warnings: string[];
}

export interface DryRunPlan {
  input: CcmixterInput;
  stemLibraryRoot: StemLibraryRoot;
  targetDirectory: string;
  groups: StemGroup[];
  plannedFiles: PlannedFile[];
  warnings: string[];
  createdAt: string;
  placeholderData: true;
}

export interface AppError {
  code: string;
  message: string;
  technicalDetail?: string;
  recoverable: boolean;
}
