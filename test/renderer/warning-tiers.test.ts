import { describe, expect, it } from 'vitest';

import { selectWarningTiers } from '../../src/renderer/ui/catalogStatus';
import type { ReviewGroup, StemGroup } from '../../src/shared/domain';

describe('selectWarningTiers', () => {
  it('returns the global warnings verbatim, never absorbing the selected group warnings', () => {
    const globalWarnings = ['No files will be downloaded.'];
    const tiers = selectWarningTiers(globalWarnings, reviewGroup());

    expect(tiers.global).toEqual(globalWarnings);
    expect(tiers.global).not.toContain('Low confidence grouping warning.');
  });

  it('combines a selected review group warnings with its override warnings', () => {
    const tiers = selectWarningTiers([], reviewGroup());

    expect(tiers.selected).toEqual(['artist override "Bad" will be sanitized.', 'Low confidence grouping warning.']);
  });

  it('returns a selected raw resolver group warnings as-is', () => {
    const tiers = selectWarningTiers([], stemGroup());

    expect(tiers.selected).toEqual(['Artist catalog group has no explicit source, stem, or archive evidence.']);
  });

  it('returns no selected warnings when nothing is selected', () => {
    const tiers = selectWarningTiers(['Global warning.'], null);

    expect(tiers.global).toEqual(['Global warning.']);
    expect(tiers.selected).toEqual([]);
  });
});

function reviewGroup(): ReviewGroup {
  return {
    reviewGroupId: 'review-group-a',
    originalGroupId: 'group-a',
    originalGroup: stemGroup(),
    artistName: 'Wiseman',
    songFolderName: 'Boxcar heading West',
    status: 'needs-review',
    files: [],
    overrides: [],
    overrideWarnings: ['artist override "Bad" will be sanitized.'],
    warnings: ['Low confidence grouping warning.'],
    mergedGroupIds: []
  };
}

function stemGroup(): StemGroup {
  return {
    groupId: 'group-a',
    artist: 'Wiseman',
    canonicalSongTitle: 'Boxcar heading West',
    uploads: [],
    files: [],
    confidence: 'low',
    metadataSource: 'api',
    groupingReasons: [],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: ['Artist catalog group has no explicit source, stem, or archive evidence.']
  };
}
