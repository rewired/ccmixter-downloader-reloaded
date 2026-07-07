import { promises as fs } from 'fs';
import path from 'path';

import { sanitizePathSegment } from '../../../shared/domain/planning';
import type { StemPackFolderRequest, StemPackInputFile, StemPackResult, StemPackWarning } from '../../../shared/domain/stemPacking';
import { probeWavFormat } from './audioProbe';
import { bestFitPack, scanStemFolder } from './expandFiles';
import { createStemPackMetadataEntries } from './packMetadata';
import { splitStereoWavToTemp } from './splitStereo';
import { StemPackError } from './types';
import { writeStemZip } from './zipStrategy';

const BYTES_PER_MB = 1024 * 1024;

export async function packStemFolder(request: StemPackFolderRequest): Promise<StemPackResult> {
  validateRequest(request);

  if (!(await isDirectory(request.folderPath))) {
    throw new StemPackError('STEM_PACK_FOLDER_NOT_FOUND', `Source folder was not found: ${request.folderPath}`);
  }

  const outputDir = request.outputDir?.trim() ? request.outputDir : request.folderPath;
  const warnings: StemPackWarning[] = [];
  const tempPaths: string[] = [];

  try {
    const scanResult = await scanStemFolder(request.folderPath);
    warnings.push(...scanResult.warnings);

    if (scanResult.audioFiles.length === 0) {
      throw new StemPackError('STEM_PACK_NO_AUDIO_FILES', `No supported audio files were found in: ${request.folderPath}`);
    }

    const totalInputBytes = scanResult.audioFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
    const maxSizeBytes = Math.floor(request.options.maxArchiveSizeMb * BYTES_PER_MB);
    const splitThresholdBytes = Math.floor(
      (request.options.splitStereoThresholdMb ?? request.options.maxArchiveSizeMb) * BYTES_PER_MB
    );

    const filesToPack = await expandWithOptionalSplitting(
      scanResult.audioFiles,
      request.options.splitOversizedStereoWav,
      splitThresholdBytes,
      tempPaths,
      warnings
    );

    const groups = bestFitPack(filesToPack, maxSizeBytes);
    warnOversizedSingleFileGroups(groups, maxSizeBytes, warnings);

    const packedAt = new Date().toISOString();
    const metadataEntries = request.options.includeStamp ? createStemPackMetadataEntries(request.metadata, packedAt) : [];
    const archives = await writeArchiveGroups(groups, outputDir, request.options.overwrite, metadataEntries);

    const cleanupFailures = await cleanupTempPaths(tempPaths);
    if (cleanupFailures.length > 0) {
      warnings.push({
        code: 'STEM_PACK_TEMP_CLEANUP_FAILED',
        message: `Failed to remove temporary split files: ${cleanupFailures.join(', ')}`
      });
    }

    return {
      archives,
      warnings,
      skippedFiles: scanResult.skippedFiles,
      tempArtifactsRemoved: cleanupFailures.length === 0,
      packedFileCount: filesToPack.length,
      totalInputBytes
    };
  } catch (error) {
    await cleanupTempPaths(tempPaths).catch(() => undefined);
    throw error;
  }
}

async function expandWithOptionalSplitting(
  audioFiles: StemPackInputFile[],
  splitEnabled: boolean,
  splitThresholdBytes: number,
  tempPaths: string[],
  warnings: StemPackWarning[]
): Promise<StemPackInputFile[]> {
  const result: StemPackInputFile[] = [];

  for (const file of audioFiles) {
    const isSplitCandidate = splitEnabled && file.extension === '.wav' && file.sizeBytes > splitThresholdBytes;
    if (!isSplitCandidate) {
      result.push(file);
      continue;
    }

    try {
      const probe = await probeWavFormat(file.path);
      if (probe.numChannels !== 2) {
        warnings.push({
          code: 'STEM_PACK_SPLIT_SKIPPED_NOT_STEREO',
          message: `Oversized WAV is not stereo (channels=${probe.numChannels}); packed without splitting: ${path.basename(file.path)}`,
          filePath: file.path
        });
        result.push(file);
        continue;
      }

      const split = await splitStereoWavToTemp(file.path, probe);
      tempPaths.push(...split.tempPaths);
      result.push(...split.files);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push({
        code: 'STEM_PACK_SPLIT_FAILED',
        message: `Could not split oversized WAV; packed original file instead: ${path.basename(file.path)} (${message})`,
        filePath: file.path
      });
      result.push(file);
    }
  }

  return result;
}

function warnOversizedSingleFileGroups(
  groups: StemPackInputFile[][],
  maxSizeBytes: number,
  warnings: StemPackWarning[]
): void {
  for (const group of groups) {
    const [onlyFile] = group;
    if (group.length === 1 && onlyFile && onlyFile.sizeBytes > maxSizeBytes) {
      warnings.push({
        code: 'STEM_PACK_FILE_EXCEEDS_MAX_SIZE',
        message: `File exceeds the configured max archive size and was packed alone: ${path.basename(onlyFile.path)}`,
        filePath: onlyFile.path
      });
    }
  }
}

async function writeArchiveGroups(
  groups: StemPackInputFile[][],
  outputDir: string,
  overwrite: boolean,
  metadataEntries: ReturnType<typeof createStemPackMetadataEntries>
): Promise<string[]> {
  const archives: string[] = [];

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group) {
      continue;
    }

    const zipName = `stems-${String(index + 1).padStart(2, '0')}`;
    const archivePath = await resolveArchivePath(outputDir, zipName, overwrite);
    const entryNames = resolveEntryNames(group);

    await writeStemZip(archivePath, group, entryNames, metadataEntries);
    archives.push(archivePath);
  }

  return archives;
}

function resolveEntryNames(files: StemPackInputFile[]): Map<string, string> {
  const usedNames = new Set<string>();
  const entryNames = new Map<string, string>();

  for (const file of files) {
    entryNames.set(file.path, resolveUniqueEntryName(usedNames, file.path));
  }

  return entryNames;
}

function resolveUniqueEntryName(usedNames: Set<string>, sourcePath: string): string {
  const baseName = sanitizePathSegment(path.basename(sourcePath));
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  const extension = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - extension.length);
  let attempt = 1;
  let candidate = `${stem} (${attempt})${extension}`;
  while (usedNames.has(candidate)) {
    attempt += 1;
    candidate = `${stem} (${attempt})${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}

async function resolveArchivePath(outputDir: string, zipName: string, overwrite: boolean): Promise<string> {
  const basePath = path.join(outputDir, `${zipName}.zip`);
  if (overwrite) {
    return basePath;
  }

  let candidate = basePath;
  let attempt = 1;
  while (await pathExists(candidate)) {
    candidate = path.join(outputDir, `${zipName}-${attempt}.zip`);
    attempt += 1;
  }
  return candidate;
}

async function cleanupTempPaths(tempPaths: string[]): Promise<string[]> {
  const uniquePaths = Array.from(new Set(tempPaths));
  const failures: string[] = [];

  for (const tempPath of uniquePaths) {
    try {
      await fs.rm(tempPath, { recursive: true, force: true });
    } catch {
      failures.push(tempPath);
    }
  }

  return failures;
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidatePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function validateRequest(request: StemPackFolderRequest): void {
  const errors: StemPackWarning[] = [];

  if (!request.folderPath.trim()) {
    errors.push({ code: 'STEM_PACK_FOLDER_REQUIRED', message: 'A source folder path is required.' });
  }
  if (!request.metadata.title.trim()) {
    errors.push({ code: 'STEM_PACK_TITLE_REQUIRED', message: 'A title is required.' });
  }
  if (!request.metadata.artist.trim()) {
    errors.push({ code: 'STEM_PACK_ARTIST_REQUIRED', message: 'An artist name is required.' });
  }
  if (!request.metadata.license.trim()) {
    errors.push({
      code: 'STEM_PACK_LICENSE_REQUIRED',
      message: 'A license is required and must not be left unknown.'
    });
  }
  if (!Number.isFinite(request.options.maxArchiveSizeMb) || request.options.maxArchiveSizeMb <= 0) {
    errors.push({ code: 'STEM_PACK_MAX_SIZE_INVALID', message: 'maxArchiveSizeMb must be a positive number.' });
  }

  if (errors.length > 0) {
    throw new StemPackError('STEM_PACK_VALIDATION_FAILED', errors.map((error) => error.message).join(' '), errors);
  }
}
