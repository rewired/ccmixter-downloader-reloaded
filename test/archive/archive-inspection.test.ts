import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { ArchiveInspectionService } from '../../src/main/services/archive/archiveInspectionService';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe('ArchiveInspectionService', () => {
  it('previews safe ZIP entries without extracting them', async () => {
    const root = await tempRoot();
    const archivePath = path.join(root, 'safe.zip');
    const destinationRoot = path.join(root, 'extract');
    await writeFile(archivePath, zipFixture([{ name: 'BASS.flac', contents: 'bass' }]));

    const preview = await new ArchiveInspectionService().previewZipArchive(archivePath, destinationRoot);

    expect(preview.entryCount).toBe(1);
    expect(preview.safeToExtract).toBe(true);
    expect(preview.entries[0]).toMatchObject({
      originalPath: 'BASS.flac',
      targetRelativePath: 'BASS.flac',
      type: 'file',
      sizeBytes: 4,
      extension: 'flac',
      blocked: false
    });
    await expect(fileExists(path.join(destinationRoot, 'BASS.flac'))).resolves.toBe(false);
  });

  it('handles nested folders as planned relative targets', async () => {
    const root = await tempRoot();
    const archivePath = path.join(root, 'nested.zip');
    await writeFile(
      archivePath,
      zipFixture([
        { name: 'stems/' },
        { name: 'stems/drums/KICK.wav', contents: 'kick' }
      ])
    );

    const preview = await new ArchiveInspectionService().previewZipArchive(archivePath, path.join(root, 'extract'));

    expect(preview.extractionPlan.plannedPaths).toEqual(['stems', 'stems/drums/KICK.wav']);
    expect(preview.entries.map((entry) => entry.type)).toEqual(['directory', 'file']);
  });

  it('blocks path traversal entries', async () => {
    const preview = await previewSingleEntry('../escape.wav');

    expect(preview.safeToExtract).toBe(false);
    expect(preview.entries[0]?.blocked).toBe(true);
    expect(preview.warnings.map((warning) => warning.code)).toContain('ARCHIVE_ENTRY_TRAVERSAL');
  });

  it('blocks absolute and drive-letter archive paths', async () => {
    const absolute = await previewSingleEntry('/tmp/escape.wav');
    const driveLetter = await previewSingleEntry('C:/Users/name/escape.wav');

    expect(absolute.warnings.map((warning) => warning.code)).toContain('ARCHIVE_ENTRY_ABSOLUTE_PATH');
    expect(driveLetter.warnings.map((warning) => warning.code)).toContain('ARCHIVE_ENTRY_ABSOLUTE_PATH');
    expect(absolute.safeToExtract).toBe(false);
    expect(driveLetter.safeToExtract).toBe(false);
  });

  it('blocks Windows reserved names instead of silently rewriting them', async () => {
    const preview = await previewSingleEntry('CON.wav');

    expect(preview.entries[0]?.targetRelativePath).toBeNull();
    expect(preview.warnings.map((warning) => warning.code)).toContain('ARCHIVE_ENTRY_RESERVED_NAME');
  });

  it('blocks duplicate sanitized target paths', async () => {
    const root = await tempRoot();
    const archivePath = path.join(root, 'duplicates.zip');
    await writeFile(
      archivePath,
      zipFixture([
        { name: 'bad:name.wav', contents: 'a' },
        { name: 'bad?name.wav', contents: 'b' }
      ])
    );

    const preview = await new ArchiveInspectionService().previewZipArchive(archivePath, path.join(root, 'extract'));

    expect(preview.entries.map((entry) => entry.targetRelativePath)).toEqual(['bad-name.wav', 'bad-name.wav']);
    expect(preview.entries.every((entry) => entry.blocked)).toBe(true);
    expect(preview.warnings.map((warning) => warning.code)).toContain('ARCHIVE_ENTRY_DUPLICATE_TARGET');
  });

  it('blocks empty and invalid entry names', async () => {
    const empty = await previewSingleEntry('');
    const invalidSegment = await previewSingleEntry('folder//file.wav');

    expect(empty.warnings.map((warning) => warning.code)).toContain('ARCHIVE_ENTRY_EMPTY');
    expect(empty.entries[0]?.blocked).toBe(true);
    expect(invalidSegment.warnings.map((warning) => warning.code)).toContain('ARCHIVE_ENTRY_INVALID_NAME');
    expect(invalidSegment.entries[0]?.blocked).toBe(true);
  });

  it('handles unknown entry sizes with a non-blocking warning', async () => {
    const root = await tempRoot();
    const archivePath = path.join(root, 'unknown-size.zip');
    await writeFile(archivePath, zipFixture([{ name: 'VOCALS.flac', unknownSize: true }]));

    const preview = await new ArchiveInspectionService().previewZipArchive(archivePath, path.join(root, 'extract'));

    expect(preview.entries[0]?.sizeBytes).toBeUndefined();
    expect(preview.entries[0]?.blocked).toBe(false);
    expect(preview.warnings).toContainEqual(
      expect.objectContaining({
        code: 'ARCHIVE_ENTRY_SIZE_UNKNOWN',
        blocking: false
      })
    );
  });
});

async function previewSingleEntry(name: string) {
  const root = await tempRoot();
  const archivePath = path.join(root, 'fixture.zip');
  await writeFile(archivePath, zipFixture([{ name, contents: 'data' }]));

  return new ArchiveInspectionService().previewZipArchive(archivePath, path.join(root, 'extract'));
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ccmixter-archive-preview-'));
  tempRoots.push(root);
  return root;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface ZipFixtureEntry {
  name: string;
  contents?: string;
  unknownSize?: boolean;
}

function zipFixture(entries: ZipFixtureEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const contents = Buffer.from(entry.contents ?? '');
    const uncompressedSize = entry.unknownSize ? 0xffffffff : contents.length;
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(entry.unknownSize ? 0xffffffff : contents.length, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(entry.unknownSize ? 0xffffffff : contents.length, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(entry.name.endsWith('/') ? 0x10 : 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);

    localHeaders.push(localHeader, contents);
    centralDirectory.push(centralHeader);
    offset += localHeader.length + contents.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBuffer = Buffer.concat(centralDirectory);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectoryBuffer.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDirectoryBuffer, eocd]);
}
