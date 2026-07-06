import { describe, expect, it } from 'vitest';

import {
  buildPlannedTargetPath,
  buildSongFolderName,
  createDryRunPlanFromFixture,
  isArtistCatalogInput,
  normalizeSongTitle,
  parseCcmixterInput,
  sanitizePathSegment
} from '../src/shared/domain';
import { sampleStemGroups } from './fixtures/sample-stem-groups';

describe('parseCcmixterInput', () => {
  it('parses numeric upload IDs', () => {
    expect(parseCcmixterInput('12345')).toMatchObject({
      kind: 'upload-id',
      uploadId: '12345'
    });
  });

  it('parses artist links', () => {
    expect(parseCcmixterInput('https://ccmixter.org/people/WiseMan')).toMatchObject({
      kind: 'artist-link',
      artistLogin: 'WiseMan',
      normalizedArtistLogin: 'wiseman'
    });
  });

  it('parses upload links', () => {
    expect(parseCcmixterInput('https://ccmixter.org/files/WiseMan/64501')).toMatchObject({
      kind: 'upload-link',
      uploadId: '64501'
    });
  });

  it('parses plain artist names', () => {
    expect(parseCcmixterInput('Lukas Engelke')).toMatchObject({
      kind: 'artist-name',
      artistLogin: 'Lukas_Engelke',
      normalizedArtistLogin: 'lukas_engelke'
    });
  });

  it('identifies artist catalog inputs', () => {
    expect(isArtistCatalogInput(parseCcmixterInput('https://ccmixter.org/people/WiseMan'))).toBe(true);
    expect(isArtistCatalogInput(parseCcmixterInput('WiseMan'))).toBe(true);
    expect(isArtistCatalogInput(parseCcmixterInput('https://ccmixter.org/files/WiseMan/64501'))).toBe(false);
    expect(isArtistCatalogInput(parseCcmixterInput('64501'))).toBe(false);
  });

  it('parses explicit fixture smoke inputs', () => {
    expect(parseCcmixterInput('fixture:haze-smoke')).toMatchObject({
      kind: 'fixture',
      fixtureId: 'haze-smoke'
    });
  });

  it('rejects ccMixter lookalike hosts', () => {
    expect(parseCcmixterInput('https://evilccmixter.org/files/WiseMan/64501')).toMatchObject({
      kind: 'unknown'
    });
    expect(parseCcmixterInput('https://ccmixter.org.evil.example/files/WiseMan/64501')).toMatchObject({
      kind: 'unknown'
    });
  });

  it('returns unknown for ambiguous junk', () => {
    expect(parseCcmixterInput('???')).toMatchObject({
      kind: 'unknown'
    });
  });
});

describe('normalizeSongTitle', () => {
  it('removes known source and stem suffixes', () => {
    expect(normalizeSongTitle('Quarter-Inch Jack (Source)')).toBe('Quarter-Inch Jack');
    expect(normalizeSongTitle('If You Are Not There [STEMS]')).toBe('If You Are Not There');
    expect(normalizeSongTitle('Boxcar heading West (pells)')).toBe('Boxcar heading West');
    expect(normalizeSongTitle('Boxcar heading West (instrumental stems)')).toBe('Boxcar heading West');
  });
});

describe('sanitizePathSegment', () => {
  it('replaces Windows-problematic characters and trims trailing spaces and dots', () => {
    expect(sanitizePathSegment('bad<name>:take?. ')).toBe('bad-name-take');
  });

  it('avoids empty names', () => {
    expect(sanitizePathSegment('   ...   ')).toBe('untitled');
  });

  it('avoids reserved Windows device names', () => {
    expect(sanitizePathSegment('CON')).toBe('_CON');
    expect(sanitizePathSegment('LPT1.txt')).toBe('_LPT1.txt');
  });
});

describe('path planning', () => {
  it('builds song folders with BPM when available', () => {
    expect(buildSongFolderName('Songname (Source)', 96)).toBe('Songname (96 BPM)');
    expect(buildSongFolderName('Songname')).toBe('Songname');
  });

  it('builds planned target paths as domain strings', () => {
    const group = sampleStemGroups[0]!;
    const file = group.files[0]!;

    expect(buildPlannedTargetPath(group, file)).toBe('Test Artist/Boxcar heading West (145 BPM)/GUITAR-main-.flac');
  });

  it('creates dry-run paths below the Stem Library Root Folder', () => {
    const plan = createDryRunPlanFromFixture(
      'https://ccmixter.org/files/TestArtist/12345',
      {
        path: 'D:/Stem Library',
        selectedAt: '2026-07-03T00:00:00.000Z'
      },
      sampleStemGroups,
      '2026-07-03T00:00:00.000Z'
    );

    expect(plan.placeholderData).toBe(true);
    expect(plan.plannedFiles[0]?.targetRelativePath).toBe('Test Artist/Boxcar heading West (145 BPM)/GUITAR-main-.flac');
    expect(plan.plannedFiles[0]?.targetAbsolutePath).toBe(
      'D:/Stem Library/Test Artist/Boxcar heading West (145 BPM)/GUITAR-main-.flac'
    );
    expect(plan.warnings).toContain('No files will be downloaded.');
  });
});
