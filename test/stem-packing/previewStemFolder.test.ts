import { mkdtemp, readdir, readFile, rm, truncate, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { STEM_PACK_PREVIEW_OVERSIZED_WAV_THRESHOLD_MB } from '../../src/shared/domain/stemPacking';
import { previewStemFolder } from '../../src/main/services/stemPacking/previewStemFolder';
import { createMonoWavBuffer } from './wavFixtures';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ccmixter-stem-preview-test-'));
  tempRoots.push(dir);
  return dir;
}

describe('previewStemFolder', () => {
  it('reports packable files, skipped files, warnings, and aggregate size/count', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());
    await writeFile(path.join(folder, 'notes.txt'), 'session notes');
    await writeFile(path.join(folder, 'old-package.zip'), 'not a real zip');

    const result = await previewStemFolder(folder);

    expect(result.folderPath).toBe(folder);
    expect(result.packableFiles.map((file) => path.basename(file.path))).toEqual(['bass.wav']);
    expect(result.packableFileCount).toBe(1);
    expect(result.totalPackableBytes).toBe(result.packableFiles[0]?.sizeBytes);
    expect(result.skippedFiles.slice().sort()).toEqual(['notes.txt', 'old-package.zip'].sort());
    expect(result.warnings.some((warning) => warning.code === 'STEM_PACK_SKIP_UNSUPPORTED')).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'STEM_PACK_SKIP_ARCHIVE')).toBe(true);
  });

  it('does not create archives, modify the folder, or leave temporary split files', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());
    const bassBuffer = await readFile(path.join(folder, 'bass.wav'));

    const tempEntriesBefore = await readdir(tmpdir());
    await previewStemFolder(folder);
    const tempEntriesAfter = await readdir(tmpdir());

    const folderEntries = await readdir(folder);
    expect(folderEntries).toEqual(['bass.wav']);
    expect(await readFile(path.join(folder, 'bass.wav'))).toEqual(bassBuffer);

    const newTempEntries = tempEntriesAfter.filter((entry) => !tempEntriesBefore.includes(entry));
    expect(newTempEntries.filter((entry) => entry.startsWith('ccmixter-stem-split-'))).toEqual([]);
  });

  it('does not flag ordinary-sized WAV files as oversized stereo candidates', async () => {
    const folder = await tempRoot();
    await writeFile(path.join(folder, 'bass.wav'), createMonoWavBuffer());

    const result = await previewStemFolder(folder);

    expect(result.hasOversizedStereoWavCandidates).toBe(false);
  });

  it('flags large WAV files as oversized stereo WAV candidates using a cheap size heuristic', async () => {
    const folder = await tempRoot();
    const bigWavPath = path.join(folder, 'big.wav');
    await writeFile(bigWavPath, createMonoWavBuffer());
    await truncate(bigWavPath, (STEM_PACK_PREVIEW_OVERSIZED_WAV_THRESHOLD_MB + 1) * 1024 * 1024);

    const result = await previewStemFolder(folder);

    expect(result.hasOversizedStereoWavCandidates).toBe(true);
  });

  it('rejects an empty folder path', async () => {
    await expect(previewStemFolder('')).rejects.toMatchObject({ code: 'STEM_PACK_FOLDER_REQUIRED' });
  });

  it('rejects a folder path that does not exist', async () => {
    const missingFolder = path.join(await tempRoot(), 'does-not-exist');

    await expect(previewStemFolder(missingFolder)).rejects.toMatchObject({ code: 'STEM_PACK_FOLDER_NOT_FOUND' });
  });
});
