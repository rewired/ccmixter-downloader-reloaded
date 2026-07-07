import {
  STEM_PACK_PREVIEW_OVERSIZED_WAV_THRESHOLD_MB,
  type StemPackPreviewResult
} from '../../../shared/domain/stemPacking';
import { scanStemFolder } from './expandFiles';
import { isDirectory } from './packStemFolder';
import { StemPackError } from './types';

const BYTES_PER_MB = 1024 * 1024;

/**
 * Read-only preview of a local folder: reuses the same scan/classification
 * logic as packStemFolder, but never splits, writes archives, or touches
 * temporary files.
 */
export async function previewStemFolder(folderPath: string): Promise<StemPackPreviewResult> {
  if (!folderPath.trim()) {
    throw new StemPackError('STEM_PACK_FOLDER_REQUIRED', 'A source folder path is required.');
  }

  if (!(await isDirectory(folderPath))) {
    throw new StemPackError('STEM_PACK_FOLDER_NOT_FOUND', `Source folder was not found: ${folderPath}`);
  }

  const scanResult = await scanStemFolder(folderPath);
  const oversizedThresholdBytes = STEM_PACK_PREVIEW_OVERSIZED_WAV_THRESHOLD_MB * BYTES_PER_MB;

  return {
    folderPath,
    packableFiles: scanResult.audioFiles,
    skippedFiles: scanResult.skippedFiles,
    warnings: scanResult.warnings,
    packableFileCount: scanResult.audioFiles.length,
    totalPackableBytes: scanResult.audioFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    hasOversizedStereoWavCandidates: scanResult.audioFiles.some(
      (file) => file.extension === '.wav' && file.sizeBytes > oversizedThresholdBytes
    )
  };
}
