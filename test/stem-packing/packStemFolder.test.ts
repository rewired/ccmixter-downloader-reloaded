import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { StemPackFolderRequest, StemPackMetadataInput, StemPackOptions } from '../../src/shared/domain/stemPacking';
import { packStemFolder } from '../../src/main/services/stemPacking/packStemFolder';
import { StemPackError } from '../../src/main/services/stemPacking/types';
import { createMonoWavBuffer, createStereoWavBuffer } from './wavFixtures';
import { readStoredZipEntries } from './zipTestUtils';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ccmixter-stem-pack-test-'));
  tempRoots.push(dir);
  return dir;
}

function defaultMetadata(overrides: Partial<StemPackMetadataInput> = {}): StemPackMetadataInput {
  return {
    title: 'Test Song',
    artist: 'Test Artist',
    license: 'CC-BY-4.0',
    ...overrides
  };
}

function defaultOptions(overrides: Partial<StemPackOptions> = {}): StemPackOptions {
  return {
    maxArchiveSizeMb: 10,
    splitOversizedStereoWav: false,
    includeStamp: true,
    overwrite: false,
    ...overrides
  };
}

function buildRequest(folderPath: string, overrides: Partial<StemPackFolderRequest> = {}): StemPackFolderRequest {
  return {
    folderPath,
    metadata: defaultMetadata(),
    options: defaultOptions(),
    ...overrides
  };
}

async function listTempSplitDirs(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((entry) => entry.startsWith('ccmixter-stem-split-'));
}

describe('packStemFolder', () => {
  it('packs a simple folder with audio files into stems-01.zip', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());
    await writeFile(path.join(folder, 'vocals.flac'), Buffer.from('fake-flac-data'));

    const result = await packStemFolder(buildRequest(folder));

    expect(result.archives).toHaveLength(1);
    expect(path.basename(result.archives[0] ?? '')).toBe('stems-01.zip');
    expect(result.packedFileCount).toBe(2);
  });

  it('includes expected audio entries under safe relative names and metadata/license/attribution/stamp files', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());
    await writeFile(path.join(folder, 'vocals.flac'), Buffer.from('fake-flac-data'));

    const result = await packStemFolder(
      buildRequest(folder, { metadata: defaultMetadata({ bpm: '120', attribution: 'Test Artist, CC-BY-4.0' }) })
    );

    const archivePath = result.archives[0];
    expect(archivePath).toBeDefined();
    const entries = readStoredZipEntries(await readFile(archivePath as string));
    const names = entries.map((entry) => entry.name).sort();

    expect(names).toEqual(
      ['ATTRIBUTION.txt', 'LICENSE.txt', 'PACK-METADATA.json', '_stem-zipper.txt', 'bass.wav', 'vocals.flac'].sort()
    );

    // Entries never contain path separators (no directories, no traversal).
    for (const entry of entries) {
      expect(entry.name).not.toMatch(/[\\/]/);
      expect(entry.name).not.toContain('..');
    }

    const metadataEntry = entries.find((entry) => entry.name === 'PACK-METADATA.json');
    const metadataJson = JSON.parse(metadataEntry?.content.toString('utf8') ?? '{}');
    expect(metadataJson).toMatchObject({
      title: 'Test Song',
      artist: 'Test Artist',
      license: 'CC-BY-4.0',
      bpm: '120',
      attribution: 'Test Artist, CC-BY-4.0'
    });

    const licenseEntry = entries.find((entry) => entry.name === 'LICENSE.txt');
    expect(licenseEntry?.content.toString('utf8')).toContain('CC-BY-4.0');

    const attributionEntry = entries.find((entry) => entry.name === 'ATTRIBUTION.txt');
    expect(attributionEntry?.content.toString('utf8').trim()).toBe('Test Artist, CC-BY-4.0');

    const stampEntry = entries.find((entry) => entry.name === '_stem-zipper.txt');
    expect(stampEntry?.content.toString('utf8')).toContain('Test Song');
  });

  it('skips unsupported files and reports them', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());
    await writeFile(path.join(folder, 'notes.txt'), 'session notes');

    const result = await packStemFolder(buildRequest(folder));

    expect(result.skippedFiles).toContain('notes.txt');
    expect(result.warnings.some((warning) => warning.code === 'STEM_PACK_SKIP_UNSUPPORTED')).toBe(true);

    const entries = readStoredZipEntries(await readFile((result.archives[0] as string)));
    expect(entries.some((entry) => entry.name === 'notes.txt')).toBe(false);
  });

  it('skips existing archive files by default', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());
    await writeFile(path.join(folder, 'old-package.zip'), Buffer.from('PKfake'));

    const result = await packStemFolder(buildRequest(folder));

    expect(result.skippedFiles).toContain('old-package.zip');
    expect(result.warnings.some((warning) => warning.code === 'STEM_PACK_SKIP_ARCHIVE')).toBe(true);

    const entries = readStoredZipEntries(await readFile((result.archives[0] as string)));
    expect(entries.some((entry) => entry.name === 'old-package.zip')).toBe(false);
  });

  it('preserves original source files unmodified', async () => {
    const folder = await tempRoot();
    const bassBuffer = createMonoWavBuffer();
    const bassPath = path.join(folder, 'bass.wav');
    await writeFile(bassPath, bassBuffer);

    await packStemFolder(buildRequest(folder));

    expect(await readFile(bassPath)).toEqual(bassBuffer);
  });

  it('handles duplicate basenames deterministically when a split output collides with an existing file', async () => {
    const folder = await tempRoot();
    const originalGuitarLeft = createMonoWavBuffer(20, 8000, 111);
    await writeFile(path.join(folder, 'guitar-L.wav'), originalGuitarLeft);
    await writeFile(path.join(folder, 'guitar.wav'), createStereoWavBuffer());

    const result = await packStemFolder(
      buildRequest(folder, {
        options: defaultOptions({ splitOversizedStereoWav: true, splitStereoThresholdMb: 0.00001 })
      })
    );

    expect(result.warnings.some((warning) => warning.code === 'STEM_PACK_SPLIT_FAILED')).toBe(false);

    const entries = readStoredZipEntries(await readFile((result.archives[0] as string)));
    const guitarRightEntries = entries.filter((entry) => entry.name === 'guitar-R.wav');
    const guitarLeftEntries = entries.filter((entry) => /^guitar-L( \(1\))?\.wav$/.test(entry.name));

    expect(guitarRightEntries).toHaveLength(1);
    expect(guitarLeftEntries).toHaveLength(2);
    expect(new Set(guitarLeftEntries.map((entry) => entry.name))).toEqual(new Set(['guitar-L.wav', 'guitar-L (1).wav']));

    const contents = guitarLeftEntries.map((entry) => entry.content.toString('hex'));
    expect(contents).toContain(originalGuitarLeft.toString('hex'));
    expect(new Set(contents).size).toBe(2);
  });

  it('returns a clear error for a missing input folder', async () => {
    const missingFolder = path.join(await tempRoot(), 'does-not-exist');

    await expect(packStemFolder(buildRequest(missingFolder))).rejects.toMatchObject({
      code: 'STEM_PACK_FOLDER_NOT_FOUND'
    });
  });

  it('rejects when required metadata is missing', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());

    await expect(
      packStemFolder(buildRequest(folder, { metadata: defaultMetadata({ license: '' }) }))
    ).rejects.toMatchObject({ code: 'STEM_PACK_VALIDATION_FAILED' });
  });

  it('cleans up temporary split files after a successful pack', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'guitar.wav'), createStereoWavBuffer());
    const before = await listTempSplitDirs();

    const result = await packStemFolder(
      buildRequest(folder, {
        options: defaultOptions({ splitOversizedStereoWav: true, splitStereoThresholdMb: 0.00001 })
      })
    );

    expect(result.tempArtifactsRemoved).toBe(true);
    const after = await listTempSplitDirs();
    expect(after.filter((entry) => !before.includes(entry))).toEqual([]);
  });

  it('cleans up temporary split files after a mid-operation failure', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'guitar.wav'), createStereoWavBuffer());

    // Force the zip-writing stage to fail by pointing outputDir at an existing file.
    const blockedOutputDir = path.join(folder, 'blocked-output');
    await writeFile(blockedOutputDir, 'not a directory');

    const before = await listTempSplitDirs();

    await expect(
      packStemFolder(
        buildRequest(folder, {
          outputDir: blockedOutputDir,
          options: defaultOptions({ splitOversizedStereoWav: true, splitStereoThresholdMb: 0.00001 })
        })
      )
    ).rejects.toThrow();

    const after = await listTempSplitDirs();
    expect(after.filter((entry) => !before.includes(entry))).toEqual([]);
  });

  it('splits an oversized stereo WAV into mono L/R entries without modifying the original', async () => {
    const folder = await tempRoot();
    const stereoBuffer = createStereoWavBuffer();
    const stereoPath = path.join(folder, 'drums.wav');
    await writeFile(stereoPath, stereoBuffer);

    const result = await packStemFolder(
      buildRequest(folder, {
        options: defaultOptions({ splitOversizedStereoWav: true, splitStereoThresholdMb: 0.00001 })
      })
    );

    const entries = readStoredZipEntries(await readFile((result.archives[0] as string)));
    const names = entries.map((entry) => entry.name);

    expect(names).toContain('drums-L.wav');
    expect(names).toContain('drums-R.wav');
    expect(names).not.toContain('drums.wav');

    expect(await readFile(stereoPath)).toEqual(stereoBuffer);
  });

  it('does not split when splitting is disabled, even for oversized stereo WAV files', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'drums.wav'), createStereoWavBuffer());

    const result = await packStemFolder(
      buildRequest(folder, { options: defaultOptions({ splitOversizedStereoWav: false }) })
    );

    const entries = readStoredZipEntries(await readFile((result.archives[0] as string)));
    const names = entries.map((entry) => entry.name);

    expect(names).toContain('drums.wav');
    expect(names).not.toContain('drums-L.wav');
    expect(names).not.toContain('drums-R.wav');
  });

  it('does not overwrite an existing archive by default and picks a deterministic non-destructive name', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());
    await writeFile(path.join(folder, 'stems-01.zip'), 'pre-existing archive');

    const result = await packStemFolder(buildRequest(folder));

    expect(path.basename(result.archives[0] ?? '')).toBe('stems-01-1.zip');
    expect(await readFile(path.join(folder, 'stems-01.zip'), 'utf8')).toBe('pre-existing archive');
  });
});
