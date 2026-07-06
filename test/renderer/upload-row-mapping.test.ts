import { describe, expect, it } from 'vitest';

import { createDryRunPlanFromGroups, createReviewSessionFromDryRunPlan, type StemGroup } from '../../src/shared/domain';
import { toRawRow, toReviewRow } from '../../src/renderer/ui/UploadListDetail';

describe('upload row mapping', () => {
  it('maps a raw resolver group to a compact row without a tags field', () => {
    const group = stemGroup();
    const row = toRawRow(group);

    expect(row).toEqual({
      id: 'group-a',
      title: 'Boxcar heading West',
      artist: 'Wiseman',
      bpm: 145,
      license: 'Attribution Noncommercial 4.0',
      fileCount: 2,
      badges: ['FLAC', 'Stem', 'MP3', 'Preview']
    });
    expect(row).not.toHaveProperty('tags');
    expect(row).not.toHaveProperty('sourceMode');
  });

  it('maps a review group to a compact row counting only included files and combined warnings', () => {
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
    expect(row.fileCount).toBe(1);
    expect(row.badges).toEqual(['FLAC', 'Stem', 'MP3', 'Preview']);
    expect(row).not.toHaveProperty('tags');
    expect(row).not.toHaveProperty('warningCount');
    expect(row).not.toHaveProperty('status');
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
