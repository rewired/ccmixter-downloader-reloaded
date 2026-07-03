import { promises as fs } from 'fs';
import path from 'path';

import {
  sanitizePathSegment,
  type ArchiveEntryPreview,
  type ArchiveExtractionWarning,
  type ArchivePreview
} from '../../../shared/domain';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_SIZE_SENTINEL = 0xffffffff;
const MAX_EOCD_SEARCH_BYTES = 0xffff + 22;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
]);

interface ZipCentralDirectoryEntry {
  filename: string;
  uncompressedSize?: number;
}

export class ArchiveInspectionService {
  async previewZipArchive(archivePath: string, destinationRootPath: string): Promise<ArchivePreview> {
    const archive = await fs.readFile(archivePath);
    const entries = parseZipCentralDirectory(archive).map((entry) => previewEntry(entry, destinationRootPath));
    markDuplicateTargets(entries);
    const warnings = uniqueWarnings(entries.flatMap((entry) => entry.warnings));
    const safeToExtract = entries.length > 0 && entries.every((entry) => !entry.blocked);

    return {
      archivePath,
      format: 'zip',
      entryCount: entries.length,
      entries,
      warnings,
      extractionPlan: {
        destinationRootPath,
        entries,
        plannedPaths: entries.flatMap((entry) => (entry.targetRelativePath ? [entry.targetRelativePath] : [])),
        warnings,
        safeToExtract,
        extractionImplemented: false
      },
      safeToExtract,
      createdAt: new Date().toISOString()
    };
  }
}

function parseZipCentralDirectory(archive: Buffer): ZipCentralDirectoryEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive);
  if (eocdOffset < 0) {
    throw new Error('ZIP end-of-central-directory record was not found.');
  }

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);

  if (centralDirectoryOffset + centralDirectorySize > archive.length) {
    throw new Error('ZIP central directory points outside the archive.');
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('ZIP central directory entry is malformed.');
    }

    const flags = archive.readUInt16LE(offset + 8);
    const uncompressedSizeRaw = archive.readUInt32LE(offset + 24);
    const filenameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + filenameLength;

    if (nameEnd > archive.length) {
      throw new Error('ZIP central directory filename is malformed.');
    }

    entries.push({
      filename: archive.subarray(nameStart, nameEnd).toString(flags & 0x0800 ? 'utf8' : 'latin1'),
      uncompressedSize: uncompressedSizeRaw === ZIP64_SIZE_SENTINEL ? undefined : uncompressedSizeRaw
    });

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const earliestOffset = Math.max(0, archive.length - MAX_EOCD_SEARCH_BYTES);

  for (let offset = archive.length - 22; offset >= earliestOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  return -1;
}

function previewEntry(entry: ZipCentralDirectoryEntry, destinationRootPath: string): ArchiveEntryPreview {
  const originalPath = entry.filename;
  const warnings: ArchiveExtractionWarning[] = [];
  const reasons: string[] = [];
  const trimmed = originalPath.trim();
  const normalizedSeparators = originalPath.replace(/\\/g, '/');
  const type = normalizedSeparators.endsWith('/') ? 'directory' : 'file';

  if (trimmed.length === 0) {
    warnings.push(warning('ARCHIVE_ENTRY_EMPTY', 'Archive entry name is empty.', true, originalPath));
  }

  if (isAbsoluteArchivePath(originalPath)) {
    warnings.push(warning('ARCHIVE_ENTRY_ABSOLUTE_PATH', `Archive entry uses an absolute path: ${originalPath}`, true, originalPath));
  }

  const withoutTrailingSlash = normalizedSeparators.replace(/\/+$/g, '');
  const rawSegments = withoutTrailingSlash.split('/');
  if (rawSegments.length === 0 || rawSegments.some((segment) => segment.length === 0)) {
    warnings.push(warning('ARCHIVE_ENTRY_INVALID_NAME', `Archive entry has an empty path segment: ${originalPath}`, true, originalPath));
  }

  if (rawSegments.some((segment) => segment === '..' || segment === '.')) {
    warnings.push(warning('ARCHIVE_ENTRY_TRAVERSAL', `Archive entry contains traversal segments: ${originalPath}`, true, originalPath));
  }

  if (rawSegments.some(isWindowsReservedName)) {
    warnings.push(warning('ARCHIVE_ENTRY_RESERVED_NAME', `Archive entry uses a Windows reserved name: ${originalPath}`, true, originalPath));
  }

  const targetRelativePath =
    warnings.some((item) => item.blocking) || rawSegments.length === 0
      ? null
      : rawSegments.map((segment) => sanitizePathSegment(segment)).join('/');

  if (targetRelativePath && targetRelativePath !== withoutTrailingSlash) {
    warnings.push(
      warning('ARCHIVE_ENTRY_SANITIZED', `Archive entry target path was sanitized to ${targetRelativePath}.`, false, originalPath)
    );
  }

  if (targetRelativePath && doesTargetEscapeRoot(destinationRootPath, targetRelativePath)) {
    warnings.push(warning('ARCHIVE_ENTRY_ROOT_ESCAPE', `Archive entry would escape the destination root: ${originalPath}`, true, originalPath));
  }

  if (typeof entry.uncompressedSize !== 'number' && type === 'file') {
    warnings.push(warning('ARCHIVE_ENTRY_SIZE_UNKNOWN', `Archive entry size is not available: ${originalPath}`, false, originalPath));
  }

  if (targetRelativePath) {
    reasons.push(`Planned target path: ${targetRelativePath}`);
  }

  if (warnings.every((item) => !item.blocking)) {
    reasons.push('Archive entry path is preview-safe.');
  }

  return {
    originalPath,
    targetRelativePath,
    type,
    sizeBytes: type === 'file' ? entry.uncompressedSize : undefined,
    extension: type === 'file' ? inferExtension(targetRelativePath ?? originalPath) : undefined,
    blocked: warnings.some((item) => item.blocking),
    warnings,
    reasons
  };
}

function markDuplicateTargets(entries: ArchiveEntryPreview[]): void {
  const targetMap = new Map<string, ArchiveEntryPreview[]>();

  for (const entry of entries) {
    if (!entry.targetRelativePath) {
      continue;
    }

    const key = entry.targetRelativePath.toLowerCase();
    const matches = targetMap.get(key) ?? [];
    matches.push(entry);
    targetMap.set(key, matches);
  }

  for (const matches of targetMap.values()) {
    if (matches.length < 2) {
      continue;
    }

    for (const entry of matches) {
      entry.warnings.push(
        warning(
          'ARCHIVE_ENTRY_DUPLICATE_TARGET',
          `Archive entry target path is duplicated after sanitizing: ${entry.targetRelativePath}`,
          true,
          entry.originalPath
        )
      );
      entry.blocked = true;
    }
  }
}

function isAbsoluteArchivePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:([\\/]|$)/.test(value) || value.startsWith('\\\\');
}

function doesTargetEscapeRoot(destinationRootPath: string, targetRelativePath: string): boolean {
  const root = path.resolve(destinationRootPath);
  const target = path.resolve(root, targetRelativePath);
  const relative = path.relative(root, target);

  return relative === '' || relative.startsWith('..') || path.isAbsolute(relative);
}

function isWindowsReservedName(segment: string): boolean {
  const baseName = segment.replace(/[ .]+$/g, '').split('.')[0]?.toUpperCase() ?? '';
  return WINDOWS_RESERVED_NAMES.has(baseName);
}

function inferExtension(value: string): string | undefined {
  const ext = path.posix.extname(value.replace(/\\/g, '/')).replace(/^\./, '').toLowerCase();
  return ext.length > 0 ? ext : undefined;
}

function warning(code: string, message: string, blocking: boolean, entryPath?: string): ArchiveExtractionWarning {
  return {
    code,
    message,
    blocking,
    entryPath
  };
}

function uniqueWarnings(warnings: ArchiveExtractionWarning[]): ArchiveExtractionWarning[] {
  const seen = new Set<string>();

  return warnings.filter((item) => {
    const key = `${item.code}:${item.message}:${item.entryPath ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
