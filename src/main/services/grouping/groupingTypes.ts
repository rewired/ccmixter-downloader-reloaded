import type { Confidence, DownloadCandidateClassification, StemGroup, TrackFile, TrackFileKind, TrackUpload } from '../../../shared/domain';

export interface GroupingUploadCandidate {
  upload: TrackUpload;
  files: TrackFile[];
}

export interface TitleRootNormalization {
  originalTitle: string;
  normalizedTitle: string;
  changed: boolean;
  removedSuffixes: string[];
  warnings: string[];
}

export interface FileClassificationContext {
  uploadTags: string[];
  uploadTitle?: string;
  fileLabel?: string;
  qualityHint?: string;
  zipFileHints?: string[];
}

export interface FileClassificationResult {
  fileKind: TrackFileKind;
  classification: DownloadCandidateClassification;
  warnings: string[];
  reasons: string[];
}

export interface GroupingSignal {
  fromUploadId: string;
  toUploadId: string;
  strength: 'strong' | 'medium' | 'weak';
  reason: string;
}

export interface StemGroupingResult {
  groups: StemGroup[];
  signals: GroupingSignal[];
  warnings: string[];
}

export interface ConfidenceAssessment {
  confidence: Confidence;
  reasons: string[];
  warnings: string[];
  ambiguousUploads: TrackUpload[];
  unverifiedFields: string[];
}
