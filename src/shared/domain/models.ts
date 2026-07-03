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

export type MetadataSourceType = 'api' | 'html-enriched' | 'fixture' | 'unresolved';

export interface TrackUpload {
  uploadId: string;
  artistName: string;
  artistLogin: string;
  title: string;
  bpm?: number;
  tags: string[];
  licenseSummary: string;
  sourceUrl: string;
  metadataSource: MetadataSourceType;
  uploadedAt?: string;
  relatedUploadUrls?: string[];
  sourceUploadIds?: string[];
  remixOfUploadIds?: string[];
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
  metadataSource: MetadataSourceType;
  zipFileHints?: string[];
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
  metadataSource: MetadataSourceType;
  groupingReasons: string[];
  ambiguousUploads: TrackUpload[];
  unverifiedFields: string[];
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
  placeholderData: boolean;
  resolverStatus: 'resolved' | 'partial' | 'unresolved' | 'fixture';
  metadataSource: MetadataSourceType;
}

export interface ResolvedCcmixterMetadata {
  input: CcmixterInput;
  groups: StemGroup[];
  uploads: TrackUpload[];
  files: TrackFile[];
  warnings: string[];
  status: DryRunPlan['resolverStatus'];
  metadataSource: MetadataSourceType;
  createdAt: string;
}

export type ReviewGroupStatus = 'needs-review' | 'accepted';

export interface RenameOverride {
  kind: 'rename';
  target: 'artist' | 'song' | 'file';
  targetId: string;
  originalValue: string;
  nextValue: string;
  sanitizedValue: string;
  warnings: string[];
}

export interface GroupOverride {
  kind: 'group';
  action: 'split' | 'merge' | 'reset' | 'accept' | 'needs-review';
  groupId: string;
  affectedGroupIds: string[];
  warnings: string[];
}

export interface FileSelectionOverride {
  kind: 'file-selection';
  fileId: string;
  included: boolean;
  warnings: string[];
}

export type ReviewOverride = RenameOverride | GroupOverride | FileSelectionOverride;

export interface ReviewFile {
  fileId: string;
  originalFile: TrackFile;
  originalFilename: string;
  targetFilename: string;
  included: boolean;
  overrideWarnings: string[];
  warnings: string[];
}

export interface ReviewGroup {
  reviewGroupId: string;
  originalGroupId: string;
  originalGroup: StemGroup;
  artistName: string;
  songFolderName: string;
  status: ReviewGroupStatus;
  files: ReviewFile[];
  overrides: ReviewOverride[];
  overrideWarnings: string[];
  warnings: string[];
  splitFromGroupId?: string;
  mergedGroupIds: string[];
}

export interface ReviewSession {
  reviewSessionId: string;
  sourcePlan: DryRunPlan;
  groups: ReviewGroup[];
  overrides: ReviewOverride[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppError {
  code: string;
  message: string;
  technicalDetail?: string;
  recoverable: boolean;
}
