import { promises as fs } from 'fs';
import path from 'path';

import {
  STEM_PACK_ARCHIVE_EXTENSIONS,
  STEM_PACK_SUPPORTED_EXTENSIONS,
  type StemPackAudioKind,
  type StemPackInputFile,
  type StemPackSupportedExtension,
  type StemPackWarning
} from '../../../shared/domain/stemPacking';

const EXTENSION_KIND: Record<StemPackSupportedExtension, StemPackAudioKind> = {
  '.wav': 'wav',
  '.flac': 'flac',
  '.mp3': 'mp3',
  '.aiff': 'aiff',
  '.aif': 'aiff',
  '.ogg': 'ogg',
  '.aac': 'aac',
  '.m4a': 'm4a',
  '.opus': 'opus',
  '.wma': 'wma'
};

function isSupportedExtension(extension: string): extension is StemPackSupportedExtension {
  return (STEM_PACK_SUPPORTED_EXTENSIONS as readonly string[]).includes(extension);
}

function isArchiveExtension(extension: string): boolean {
  return (STEM_PACK_ARCHIVE_EXTENSIONS as readonly string[]).includes(extension);
}

export interface FolderScanResult {
  audioFiles: StemPackInputFile[];
  skippedFiles: string[];
  warnings: StemPackWarning[];
}

/**
 * Scans the top level of a local folder only. Stem export folders are flat,
 * and non-recursive scanning keeps duplicate-name handling deterministic.
 */
export async function scanStemFolder(folderPath: string): Promise<FolderScanResult> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const fileEntries = entries.filter((entry) => entry.isFile()).sort((a, b) => a.name.localeCompare(b.name));

  const audioFiles: StemPackInputFile[] = [];
  const skippedFiles: string[] = [];
  const warnings: StemPackWarning[] = [];

  for (const entry of fileEntries) {
    const absolutePath = path.join(folderPath, entry.name);
    const extension = path.extname(entry.name).toLowerCase();

    if (isArchiveExtension(extension)) {
      skippedFiles.push(entry.name);
      warnings.push({
        code: 'STEM_PACK_SKIP_ARCHIVE',
        message: `Archive files are skipped by default: ${entry.name}`,
        filePath: absolutePath
      });
      continue;
    }

    if (!isSupportedExtension(extension)) {
      skippedFiles.push(entry.name);
      warnings.push({
        code: 'STEM_PACK_SKIP_UNSUPPORTED',
        message: `Unsupported file type is skipped: ${entry.name}`,
        filePath: absolutePath
      });
      continue;
    }

    const stats = await fs.stat(absolutePath);
    audioFiles.push({
      path: absolutePath,
      sizeBytes: stats.size,
      extension,
      kind: EXTENSION_KIND[extension]
    });
  }

  return { audioFiles, skippedFiles, warnings };
}

/**
 * First-fit-decreasing bin packing. Deterministic tie-break by path so that
 * grouping does not depend on directory listing order.
 */
export function bestFitPack(files: StemPackInputFile[], maxSizeBytes: number): StemPackInputFile[][] {
  if (files.length === 0) {
    return [];
  }

  const sorted = [...files].sort((a, b) => {
    if (b.sizeBytes !== a.sizeBytes) {
      return b.sizeBytes - a.sizeBytes;
    }
    return a.path.localeCompare(b.path);
  });

  const bins: { items: StemPackInputFile[]; used: number }[] = [];

  for (const file of sorted) {
    let targetIndex = -1;
    let bestRemaining = Number.POSITIVE_INFINITY;

    for (let index = 0; index < bins.length; index += 1) {
      const bin = bins[index];
      if (!bin) {
        continue;
      }
      const remaining = maxSizeBytes - bin.used;
      if (file.sizeBytes <= remaining && remaining < bestRemaining) {
        bestRemaining = remaining;
        targetIndex = index;
      }
    }

    if (targetIndex === -1) {
      bins.push({ items: [file], used: file.sizeBytes });
    } else {
      const bin = bins[targetIndex];
      if (bin) {
        bin.items.push(file);
        bin.used += file.sizeBytes;
      }
    }
  }

  return bins.map((bin) => bin.items);
}
