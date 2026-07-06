import { describe, expect, it } from 'vitest';

import { preferMusicianFacingFileLabel, resolveMusicianFacingFileLabel } from '../../src/shared/domain';

describe('resolveMusicianFacingFileLabel', () => {
  it('accepts a meaningful label and strips a matching extension suffix', () => {
    expect(
      resolveMusicianFacingFileLabel({
        displayLabel: 'Stems, Second Half',
        originalFilename: 'Zutsuri_-_Haze.zip',
        extension: 'zip'
      })
    ).toBe('Stems, Second Half');
  });

  it('rejects an empty label', () => {
    expect(resolveMusicianFacingFileLabel({ displayLabel: '  ', originalFilename: 'song.zip', extension: 'zip' })).toBeUndefined();
    expect(resolveMusicianFacingFileLabel({ displayLabel: undefined, originalFilename: 'song.zip', extension: 'zip' })).toBeUndefined();
  });

  it('rejects extension-only labels regardless of the file its own extension', () => {
    expect(resolveMusicianFacingFileLabel({ displayLabel: 'zip', originalFilename: 'song.zip', extension: 'zip' })).toBeUndefined();
    expect(resolveMusicianFacingFileLabel({ displayLabel: 'mp3', originalFilename: 'song.zip', extension: 'zip' })).toBeUndefined();
  });

  it('rejects labels equal to the original filename, with or without extension', () => {
    expect(
      resolveMusicianFacingFileLabel({ displayLabel: 'Song-stems.zip', originalFilename: 'Song-stems.zip', extension: 'zip' })
    ).toBeUndefined();
    expect(
      resolveMusicianFacingFileLabel({ displayLabel: 'Song-stems', originalFilename: 'Song-stems.zip', extension: 'zip' })
    ).toBeUndefined();
  });

  it('keeps a generic label when used standalone, since no better label is available', () => {
    expect(
      resolveMusicianFacingFileLabel({ displayLabel: 'Archive', originalFilename: 'song-extras.zip', extension: 'zip' })
    ).toBe('Archive');
  });
});

describe('preferMusicianFacingFileLabel', () => {
  it('prefers a specific label over a generic one', () => {
    expect(preferMusicianFacingFileLabel('Archive', 'Stems, Second Half')).toBe('Stems, Second Half');
    expect(preferMusicianFacingFileLabel('Stems, Second Half', 'Archive')).toBe('Stems, Second Half');
  });

  it('falls back to whichever label exists when the other is missing', () => {
    expect(preferMusicianFacingFileLabel(undefined, 'Stems, Second Half')).toBe('Stems, Second Half');
    expect(preferMusicianFacingFileLabel('Stems, Second Half', undefined)).toBe('Stems, Second Half');
  });

  it('keeps a generic label when nothing better is available', () => {
    expect(preferMusicianFacingFileLabel('Archive', undefined)).toBe('Archive');
    expect(preferMusicianFacingFileLabel(undefined, 'Archive')).toBe('Archive');
  });
});
