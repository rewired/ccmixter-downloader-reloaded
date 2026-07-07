export const STEM_PACK_SUPPORTED_EXTENSIONS = [
  '.wav',
  '.flac',
  '.mp3',
  '.aiff',
  '.aif',
  '.ogg',
  '.aac',
  '.m4a',
  '.opus',
  '.wma'
] as const;

export type StemPackSupportedExtension = (typeof STEM_PACK_SUPPORTED_EXTENSIONS)[number];

export const STEM_PACK_ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar', '.tar', '.gz'] as const;

export type StemPackAudioKind = 'wav' | 'flac' | 'mp3' | 'aiff' | 'ogg' | 'aac' | 'm4a' | 'opus' | 'wma';

export interface StemPackMetadataInput {
  title: string;
  artist: string;
  bpm?: string;
  license: string;
  attribution?: string;
}

export interface StemPackOptions {
  maxArchiveSizeMb: number;
  splitOversizedStereoWav: boolean;
  splitStereoThresholdMb?: number;
  includeStamp: boolean;
  overwrite: boolean;
}

export interface StemPackFolderRequest {
  folderPath: string;
  outputDir?: string;
  metadata: StemPackMetadataInput;
  options: StemPackOptions;
}

export interface StemPackInputFile {
  path: string;
  sizeBytes: number;
  extension: StemPackSupportedExtension;
  kind: StemPackAudioKind;
}

export interface StemPackWarning {
  code: string;
  message: string;
  filePath?: string;
}

export interface StemPackResult {
  archives: string[];
  warnings: StemPackWarning[];
  skippedFiles: string[];
  tempArtifactsRemoved: boolean;
  packedFileCount: number;
  totalInputBytes: number;
}

// Matches the reference Stem ZIPper project's default max archive size (see
// docs/stem-zipper-port-map.md dependency map). Used only as a cheap, size-based
// heuristic for flagging oversized-stereo-WAV candidates during preview, without
// opening every file to probe actual channel count.
export const STEM_PACK_PREVIEW_OVERSIZED_WAV_THRESHOLD_MB = 48;

export interface StemPackPreviewResult {
  folderPath: string;
  packableFiles: StemPackInputFile[];
  skippedFiles: string[];
  warnings: StemPackWarning[];
  packableFileCount: number;
  totalPackableBytes: number;
  hasOversizedStereoWavCandidates: boolean;
}
