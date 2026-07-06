import { describe, expect, it } from 'vitest';

import {
  buildReviewedDryRunPlan,
  clearIncludedDownloadCandidates,
  createDryRunPlanFromGroups,
  createReviewSessionFromDryRunPlan,
  excludeArchiveDownloadCandidates,
  excludePreviewDownloadCandidates,
  includeRecommendedDownloadCandidates,
  markGroupAccepted,
  markGroupNeedsReview,
  mergeGroups,
  renameArtist,
  renameFile,
  renameGroup,
  resetGroupOverrides,
  splitGroup,
  toggleFileIncluded,
  type DryRunPlan,
  type StemGroup
} from '../../src/shared/domain';

describe('review session overrides', () => {
  it('creates review state from a dry-run plan and preserves resolver metadata', () => {
    const plan = createPlan();
    const session = createReviewSessionFromDryRunPlan(plan);

    expect(session.groups).toHaveLength(2);
    expect(session.groups[0]?.originalGroup).toBe(plan.groups[0]);
    expect(session.groups[0]?.songFolderName).toBe('Boxcar heading West (145 BPM)');
    expect(session.groups[0]?.files[0]?.originalFile).toBe(plan.groups[0]?.files[0]);
  });

  it('renames artist, group/song folder, and file without mutating the original session', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const fileId = session.groups[0]!.files[0]!.fileId;
    const renamed = renameFile(renameGroup(renameArtist(session, 'group-a', 'Edited Artist'), 'group-a', 'Edited Song'), fileId, 'BASS.wav');

    expect(session.groups[0]?.artistName).toBe('Wiseman');
    expect(renamed.groups[0]?.artistName).toBe('Edited Artist');
    expect(renamed.groups[0]?.songFolderName).toBe('Edited Song');
    expect(renamed.groups[0]?.files[0]?.targetFilename).toBe('BASS.wav');
    expect(renamed.groups[0]?.originalGroup.artist).toBe('Wiseman');
  });

  it('adds sanitizer warnings for unsafe override names and recomputes planned paths sanitized', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const fileId = session.groups[0]!.files[0]!.fileId;
    const renamed = toggleFileIncluded(
      renameFile(renameGroup(renameArtist(session, 'group-a', 'Bad:Artist'), 'group-a', 'Song/Name'), fileId, 'BASS?.wav'),
      fileId
    );
    const plan = buildReviewedDryRunPlan(renamed, root());

    expect(renamed.groups[0]?.overrideWarnings).toContain('artist override "Bad:Artist" will be sanitized to "Bad-Artist".');
    expect(renamed.groups[0]?.overrideWarnings).toContain('song override "Song/Name" will be sanitized to "Song-Name".');
    expect(renamed.groups[0]?.files[0]?.overrideWarnings).toContain('file override "BASS?.wav" will be sanitized to "BASS-.wav".');
    expect(plan.plannedFiles[0]?.targetRelativePath).toBe('Bad-Artist/Song-Name/BASS-.wav');
  });

  it('does not leak per-group or per-file warnings into the reviewed plan-level warning list', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const plan = buildReviewedDryRunPlan(session, root());

    expect(session.groups[0]?.warnings).toContain('Low confidence grouping warning.');
    expect(plan.warnings).not.toContain('Low confidence grouping warning.');
    expect(plan.warnings).not.toContain('Preview file classification warning.');
  });

  it('excludes files from reviewed planned files while keeping them visible in review state', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const fileId = session.groups[0]!.files[0]!.fileId;
    const includedThenExcluded = toggleFileIncluded(toggleFileIncluded(session, fileId), fileId);
    const plan = buildReviewedDryRunPlan(includedThenExcluded, root());

    expect(includedThenExcluded.groups[0]?.files[0]?.included).toBe(false);
    expect(includedThenExcluded.groups[0]?.files).toHaveLength(2);
    expect(plan.plannedFiles.map((file) => file.sourceFile.originalFilename)).not.toContain('BASS.flac');
    expect(plan.plannedFiles.map((file) => file.sourceFile.originalFilename)).not.toContain('preview.mp3');
  });

  it('does not preselect any review files by default, regardless of role', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan('WiseMan'));

    expect(session.sourcePlan.input.kind).toBe('artist-name');
    expect(session.groups[0]?.files.map((file) => file.included)).toEqual([false, false]);
    expect(session.groups[1]?.files.map((file) => file.included)).toEqual([false]);
  });

  it('keeps upload-link, upload-id, and fixture review files unselected the same musician-facing way', () => {
    const uploadLinkSession = createReviewSessionFromDryRunPlan(createPlan('https://ccmixter.org/files/WiseMan/64501'));
    const uploadIdSession = createReviewSessionFromDryRunPlan(createPlan('64501'));
    const fixtureSession = createReviewSessionFromDryRunPlan(createPlan('fixture:haze-smoke'));

    expect(uploadLinkSession.sourcePlan.input.kind).toBe('upload-link');
    expect(uploadLinkSession.groups.flatMap((group) => group.files).map((file) => file.included)).toEqual([false, false, false]);
    expect(uploadIdSession.sourcePlan.input.kind).toBe('upload-id');
    expect(uploadIdSession.groups.flatMap((group) => group.files).map((file) => file.included)).toEqual([false, false, false]);
    expect(fixtureSession.sourcePlan.input.kind).toBe('fixture');
    expect(fixtureSession.groups.flatMap((group) => group.files).map((file) => file.included)).toEqual([false, false, false]);
  });

  it('uses an alternate display label for the default target filename while preserving the real extension', () => {
    const session = createReviewSessionFromDryRunPlan(
      createDryRunPlanFromGroups(
        'https://ccmixter.org/files/WiseMan/64501',
        root(),
        [
          {
            ...groupA(),
            files: [
              {
                originalFilename: 'Zutsuri_-_Haze.zip',
                fileKind: 'archive',
                extension: 'zip',
                displayLabel: 'Stems, Second Half',
                downloadUrl: 'https://ccmixter.org/content/Zutsuri/Zutsuri_-_Haze.zip',
                metadataSource: 'api',
                warnings: []
              }
            ]
          }
        ],
        {
          createdAt: '2026-07-03T00:00:00.000Z',
          metadataSource: 'api',
          placeholderData: false,
          resolverStatus: 'resolved',
          warnings: []
        }
      )
    );

    expect(session.groups[0]?.files[0]?.targetFilename).toBe('Stems, Second Half.zip');
    expect(session.groups[0]?.files[0]?.originalFilename).toBe('Zutsuri_-_Haze.zip');
  });

  it('gives duplicate alternate-label target filenames a stable unique suffix', () => {
    const session = createReviewSessionFromDryRunPlan(
      createDryRunPlanFromGroups(
        'https://ccmixter.org/files/WiseMan/64501',
        root(),
        [
          {
            ...groupA(),
            files: [
              {
                originalFilename: 'song-a.zip',
                fileKind: 'archive',
                extension: 'zip',
                displayLabel: 'Stems',
                downloadUrl: 'https://ccmixter.org/content/WiseMan/song-a.zip',
                metadataSource: 'api',
                warnings: []
              },
              {
                originalFilename: 'song-b.zip',
                fileKind: 'archive',
                extension: 'zip',
                displayLabel: 'Stems',
                downloadUrl: 'https://ccmixter.org/content/WiseMan/song-b.zip',
                metadataSource: 'api',
                warnings: []
              }
            ]
          }
        ],
        {
          createdAt: '2026-07-03T00:00:00.000Z',
          metadataSource: 'api',
          placeholderData: false,
          resolverStatus: 'resolved',
          warnings: []
        }
      )
    );

    expect(session.groups[0]?.files.map((file) => file.targetFilename)).toEqual(['Stems.zip', 'Stems (2).zip']);
  });

  it('plans no files from an untouched artist catalog review and says so explicitly', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan('https://ccmixter.org/people/WiseMan'));
    const plan = buildReviewedDryRunPlan(session, root());

    expect(session.sourcePlan.input.kind).toBe('artist-link');
    expect(plan.plannedFiles).toEqual([]);
    expect(plan.warnings).toContain('No files are included in the reviewed dry-run plan.');
  });

  it('applies candidate review actions explicitly', () => {
    const cleared = clearIncludedDownloadCandidates(createReviewSessionFromDryRunPlan(createPlan()));
    const recommended = includeRecommendedDownloadCandidates(createReviewSessionFromDryRunPlan(createPlan()));
    const withoutPreviews = excludePreviewDownloadCandidates(includeRecommendedDownloadCandidates(createReviewSessionFromDryRunPlan(createPlan())));
    const withoutArchives = excludeArchiveDownloadCandidates(
      includeRecommendedDownloadCandidates(createReviewSessionFromDryRunPlan(createPlanWithArchive()))
    );

    expect(cleared.groups[0]?.files.map((file) => file.included)).toEqual([false, false]);
    expect(recommended.groups[0]?.files.map((file) => file.included)).toEqual([true, false]);
    expect(recommended.groups[1]?.files.map((file) => file.included)).toEqual([true]);
    expect(withoutPreviews.groups[0]?.files.map((file) => file.included)).toEqual([true, false]);
    expect(withoutArchives.groups[0]?.files.map((file) => file.included)).toEqual([true, false, false]);
  });

  it('marks groups accepted and needs review without removing low-confidence warnings', () => {
    const accepted = markGroupAccepted(createReviewSessionFromDryRunPlan(createPlan()), 'group-a');
    const needsReview = markGroupNeedsReview(accepted, 'group-a');

    expect(accepted.groups[0]?.status).toBe('accepted');
    expect(accepted.groups[0]?.warnings).toContain('Low confidence grouping warning.');
    expect(needsReview.groups[0]?.status).toBe('needs-review');
  });

  it('splits a group and preserves moved files and warnings', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const movedFileId = session.groups[0]!.files[1]!.fileId;
    const split = splitGroup(session, 'group-a', [movedFileId]);

    expect(split.groups).toHaveLength(3);
    expect(split.groups[0]?.files.map((file) => file.originalFilename)).toEqual(['BASS.flac']);
    expect(split.groups[1]?.files.map((file) => file.originalFilename)).toEqual(['preview.mp3']);
    expect(split.groups[1]?.warnings).toContain('Group was split manually and needs review.');
    expect(split.groups[1]?.splitFromGroupId).toBe('group-a');
  });

  it('merges groups and preserves files and provenance', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const merged = mergeGroups(session, 'group-b', 'group-a');

    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0]?.files.map((file) => file.originalFilename)).toEqual(['BASS.flac', 'preview.mp3', 'VOCALS.flac']);
    expect(merged.groups[0]?.mergedGroupIds).toContain('group-b');
  });

  it('resets group overrides to resolver defaults', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const fileId = session.groups[0]!.files[0]!.fileId;
    const renamed = renameFile(renameGroup(renameArtist(session, 'group-a', 'Edited Artist'), 'group-a', 'Edited Song'), fileId, 'BASS.wav');
    const reset = resetGroupOverrides(renamed, 'group-a');

    expect(reset.groups[0]?.artistName).toBe('Wiseman');
    expect(reset.groups[0]?.songFolderName).toBe('Boxcar heading West (145 BPM)');
    expect(reset.groups[0]?.files[0]?.targetFilename).toBe('BASS.flac');
  });

  it('recomputes reviewed dry-run paths from overrides', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const fileId = session.groups[0]!.files[0]!.fileId;
    const reviewed = toggleFileIncluded(
      renameFile(renameGroup(renameArtist(session, 'group-a', 'Edited Artist'), 'group-a', 'Edited Song'), fileId, 'BASS.wav'),
      fileId
    );
    const plan = buildReviewedDryRunPlan(reviewed, root());

    expect(plan.plannedFiles[0]?.targetRelativePath).toBe('Edited Artist/Edited Song/BASS.wav');
    expect(plan.plannedFiles[0]?.targetAbsolutePath).toBe('D:/Stem Library/Edited Artist/Edited Song/BASS.wav');
  });
});

function createPlan(rawInput = 'https://ccmixter.org/files/WiseMan/64501'): DryRunPlan {
  return createDryRunPlanFromGroups(
    rawInput,
    root(),
    [groupA(), groupB()],
    {
      createdAt: '2026-07-03T00:00:00.000Z',
      metadataSource: 'api',
      placeholderData: false,
      resolverStatus: 'resolved',
      warnings: ['No files will be downloaded.']
    }
  );
}

function createPlanWithArchive(): DryRunPlan {
  return createDryRunPlanFromGroups(
    'https://ccmixter.org/files/WiseMan/64501',
    root(),
    [
      {
        ...groupA(),
        files: [
          ...groupA().files,
          {
            originalFilename: 'Boxcar-stems.zip',
            fileKind: 'archive',
            extension: 'zip',
            downloadUrl: 'https://ccmixter.org/content/WiseMan/Boxcar-stems.zip',
            metadataSource: 'api',
            zipFileHints: ['BASS.flac'],
            warnings: []
          }
        ]
      }
    ],
    {
      createdAt: '2026-07-03T00:00:00.000Z',
      metadataSource: 'api',
      placeholderData: false,
      resolverStatus: 'resolved',
      warnings: ['No files will be downloaded.']
    }
  );
}

function root() {
  return {
    path: 'D:/Stem Library',
    selectedAt: '2026-07-03T00:00:00.000Z'
  };
}

function groupA(): StemGroup {
  return {
    groupId: 'group-a',
    artist: 'Wiseman',
    canonicalSongTitle: 'Boxcar heading West',
    bpm: 145,
    uploads: [],
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
        warnings: ['Preview file classification warning.']
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

function groupB(): StemGroup {
  return {
    groupId: 'group-b',
    artist: 'Wiseman',
    canonicalSongTitle: 'Boxcar heading West',
    bpm: 145,
    uploads: [],
    files: [
      {
        originalFilename: 'VOCALS.flac',
        fileKind: 'stem',
        extension: 'flac',
        downloadUrl: 'https://ccmixter.org/content/WiseMan/VOCALS.flac',
        metadataSource: 'api',
        warnings: []
      }
    ],
    confidence: 'medium',
    metadataSource: 'api',
    groupingReasons: ['API source/remix relationship references another upload in this group.'],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: []
  };
}
