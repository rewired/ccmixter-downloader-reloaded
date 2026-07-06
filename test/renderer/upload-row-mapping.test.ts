import { describe, expect, it } from 'vitest';

import { createDryRunPlanFromGroups, createReviewSessionFromDryRunPlan, type StemGroup } from '../../src/shared/domain';
import { capArchiveHints, MAX_INLINE_ARCHIVE_HINTS, toRawRow, toReviewRow } from '../../src/renderer/ui/UploadListDetail';

describe('upload row mapping', () => {
  it('maps a raw resolver group to a compact row of discovered files without a tags or badges field', () => {
    const group = stemGroup();
    const row = toRawRow(group);

    expect(row).toEqual({
      id: 'group-a',
      title: 'Boxcar heading West',
      artist: 'Wiseman',
      bpm: 145,
      license: 'Attribution Noncommercial 4.0',
      discoveredFileCount: 2
    });
    expect(row).not.toHaveProperty('tags');
    expect(row).not.toHaveProperty('sourceMode');
    expect(row).not.toHaveProperty('badges');
  });

  it('maps a review group to a compact row separating discovered files from selected files', () => {
    const plan = createDryRunPlanFromGroups('https://ccmixter.org/files/WiseMan/64501', root(), [stemGroup()], {
      createdAt: '2026-07-03T00:00:00.000Z',
      metadataSource: 'api',
      placeholderData: false,
      resolverStatus: 'resolved',
      warnings: []
    });
    const session = createReviewSessionFromDryRunPlan(plan);
    const row = toReviewRow(session.groups[0]!);

    expect(row.id).toBe(session.groups[0]!.reviewGroupId);
    expect(row.title).toBe('Boxcar heading West (145 BPM)');
    expect(row.artist).toBe('Wiseman');
    expect(row.bpm).toBe(145);
    expect(row.discoveredFileCount).toBe(2);
    expect(row.selectedFileCount).toBe(0);
    expect(row).not.toHaveProperty('tags');
    expect(row).not.toHaveProperty('warningCount');
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('badges');
  });

  it('keeps a group with discovered files visible in review rows even when none are selected', () => {
    const plan = createDryRunPlanFromGroups('https://ccmixter.org/files/WiseMan/64501', root(), [stemGroup()], {
      createdAt: '2026-07-03T00:00:00.000Z',
      metadataSource: 'api',
      placeholderData: false,
      resolverStatus: 'resolved',
      warnings: []
    });
    const session = createReviewSessionFromDryRunPlan(plan);
    const row = toReviewRow(session.groups[0]!);

    expect(row.discoveredFileCount).toBeGreaterThan(0);
    expect(row.selectedFileCount).toBe(0);
  });
});

describe('capArchiveHints', () => {
  it('leaves a short archive entry list untouched', () => {
    const entries = ['a.flac', 'b.flac', 'c.flac'];

    expect(capArchiveHints(entries)).toEqual({ visible: entries, hiddenCount: 0 });
  });

  it('caps a large archive entry list at the max and reports how many were hidden', () => {
    const entries = Array.from({ length: 45 }, (_value, index) => `track-${index}.flac`);
    const result = capArchiveHints(entries);

    expect(result.visible).toHaveLength(MAX_INLINE_ARCHIVE_HINTS);
    expect(result.visible).toEqual(entries.slice(0, MAX_INLINE_ARCHIVE_HINTS));
    expect(result.hiddenCount).toBe(45 - MAX_INLINE_ARCHIVE_HINTS);
  });
});

function root() {
  return { path: 'D:/Stem Library', selectedAt: '2026-07-03T00:00:00.000Z' };
}

function stemGroup(): StemGroup {
  return {
    groupId: 'group-a',
    artist: 'Wiseman',
    canonicalSongTitle: 'Boxcar heading West',
    bpm: 145,
    uploads: [
      {
        uploadId: '64501',
        artistName: 'Wiseman',
        artistLogin: 'WiseMan',
        title: 'Boxcar heading West',
        bpm: 145,
        tags: ['rock', 'guitar'],
        licenseSummary: 'Attribution Noncommercial 4.0',
        sourceUrl: 'https://ccmixter.org/files/WiseMan/64501',
        metadataSource: 'api',
        warnings: []
      }
    ],
    files: [
      {
        originalFilename: 'BASS.flac',
        fileKind: 'stem',
        extension: 'flac',
        downloadUrl: 'https://ccmixter.org/content/WiseMan/BASS.flac',
        metadataSource: 'api',
        warnings: []
      },
      {
        originalFilename: 'preview.mp3',
        fileKind: 'preview',
        extension: 'mp3',
        downloadUrl: 'https://ccmixter.org/content/WiseMan/preview.mp3',
        metadataSource: 'api',
        warnings: []
      }
    ],
    confidence: 'low',
    metadataSource: 'api',
    groupingReasons: ['Same artist and normalized song title root.'],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: ['Low confidence grouping warning.']
  };
}
