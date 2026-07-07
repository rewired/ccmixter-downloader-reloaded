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
