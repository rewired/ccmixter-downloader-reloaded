import type {
  DryRunPlan,
  MetadataSourceType,
  PlannedFile,
  ReviewFile,
  ReviewGroup,
  ReviewOverride,
  ReviewSession,
  StemGroup,
  StemLibraryRoot,
  TrackFile
} from './models';
import { getDownloadCandidateClassification, isRecommendedDownloadCandidate } from './classification';
import { buildSongFolderName, sanitizePathSegment } from './planning';

export function createReviewSessionFromDryRunPlan(plan: DryRunPlan): ReviewSession {
  const groups = plan.groups.map((group) => createReviewGroup(group));

  return {
    reviewSessionId: `review-${plan.createdAt}`,
    sourcePlan: plan,
    groups,
    overrides: [],
    warnings: plan.warnings,
    createdAt: plan.createdAt,
    updatedAt: plan.createdAt
  };
}

export function renameGroup(session: ReviewSession, groupId: string, nextName: string): ReviewSession {
  return updateGroup(session, groupId, (group) => {
    const override = createRenameOverride('song', group.reviewGroupId, group.songFolderName, nextName);

    return {
      ...group,
      songFolderName: nextName,
      overrides: replaceOverride(group.overrides, override),
      overrideWarnings: mergeWarnings(group.overrideWarnings, override.warnings)
    };
  });
}

export function renameArtist(session: ReviewSession, groupId: string, nextArtistName: string): ReviewSession {
  return updateGroup(session, groupId, (group) => {
    const override = createRenameOverride('artist', group.reviewGroupId, group.artistName, nextArtistName);

    return {
      ...group,
      artistName: nextArtistName,
      overrides: replaceOverride(group.overrides, override),
      overrideWarnings: mergeWarnings(group.overrideWarnings, override.warnings)
    };
  });
}

export function renameFile(session: ReviewSession, fileId: string, nextFilename: string): ReviewSession {
  let override: ReviewOverride | undefined;
  const nextSession = updateFile(session, fileId, (file) => {
    const fileOverride = createRenameOverride('file', file.fileId, file.targetFilename, nextFilename);
    override = fileOverride;

    return {
      ...file,
      targetFilename: nextFilename,
      overrideWarnings: mergeWarnings(file.overrideWarnings, fileOverride.warnings),
      warnings: mergeWarnings(file.warnings, fileOverride.warnings)
    };
  });

  return override ? addSessionOverride(nextSession, override) : nextSession;
}

export function toggleFileIncluded(session: ReviewSession, fileId: string): ReviewSession {
  let override: ReviewOverride | undefined;
  const nextSession = updateFile(session, fileId, (file) => {
    override = {
      kind: 'file-selection',
      fileId,
      included: !file.included,
      warnings: []
    };

    return {
      ...file,
      included: !file.included
    };
  });

  return override ? addSessionOverride(nextSession, override) : nextSession;
}

export function includeRecommendedDownloadCandidates(session: ReviewSession): ReviewSession {
  return setFileInclusion(session, (file) => isRecommendedDownloadCandidate(file.originalFile));
}

export function excludePreviewDownloadCandidates(session: ReviewSession): ReviewSession {
  return setFileInclusion(session, (file) =>
    getDownloadCandidateClassification(file.originalFile).role === 'preview' ? false : file.included
  );
}

export function excludeArchiveDownloadCandidates(session: ReviewSession): ReviewSession {
  return setFileInclusion(session, (file) =>
    getDownloadCandidateClassification(file.originalFile).role === 'archive' ? false : file.included
  );
}

export function clearIncludedDownloadCandidates(session: ReviewSession): ReviewSession {
  return setFileInclusion(session, () => false);
}

export function markGroupAccepted(session: ReviewSession, groupId: string): ReviewSession {
  return updateGroupWithGroupOverride(session, groupId, 'accept', (group) => ({
    ...group,
    status: 'accepted'
  }));
}

export function markGroupNeedsReview(session: ReviewSession, groupId: string): ReviewSession {
  return updateGroupWithGroupOverride(session, groupId, 'needs-review', (group) => ({
    ...group,
    status: 'needs-review'
  }));
}

export function splitGroup(session: ReviewSession, groupId: string, fileIdsForNewGroup: string[]): ReviewSession {
  const group = session.groups.find((candidate) => candidate.reviewGroupId === groupId);
  const selectedFileIds = new Set(fileIdsForNewGroup);

  if (!group) {
    return addSessionWarning(session, `Review group ${groupId} was not found.`);
  }

  const movedFiles = group.files.filter((file) => selectedFileIds.has(file.fileId));
  const remainingFiles = group.files.filter((file) => !selectedFileIds.has(file.fileId));

  if (movedFiles.length === 0 || remainingFiles.length === 0) {
    return addSessionWarning(session, 'Split requires at least one file to move and one file to remain.');
  }

  const splitGroupId = `${group.reviewGroupId}-split-${session.groups.length + 1}`;
  const splitOverride: ReviewOverride = {
    kind: 'group',
    action: 'split',
    groupId,
    affectedGroupIds: [splitGroupId],
    warnings: []
  };
  const nextGroups = session.groups.flatMap((candidate) => {
    if (candidate.reviewGroupId !== groupId) {
      return [candidate];
    }

    return [
      {
        ...candidate,
        files: remainingFiles,
        overrides: [...candidate.overrides, splitOverride]
      },
      {
        ...candidate,
        reviewGroupId: splitGroupId,
        originalGroupId: candidate.originalGroupId,
        songFolderName: `${candidate.songFolderName} split`,
        status: 'needs-review' as const,
        files: movedFiles.map((file) => ({
          ...file,
          fileId: file.fileId.replace(`${groupId}::`, `${splitGroupId}::`)
        })),
        overrides: [splitOverride],
        overrideWarnings: mergeWarnings(candidate.overrideWarnings, ['Group was split manually and needs review.']),
        warnings: mergeWarnings(candidate.warnings, ['Group was split manually and needs review.']),
        splitFromGroupId: groupId,
        mergedGroupIds: []
      }
    ];
  });

  return addSessionOverride(
    {
      ...session,
      groups: nextGroups
    },
    splitOverride
  );
}

export function mergeGroups(session: ReviewSession, sourceGroupId: string, targetGroupId: string): ReviewSession {
  if (sourceGroupId === targetGroupId) {
    return addSessionWarning(session, 'Merge requires two different groups.');
  }

  const sourceGroup = session.groups.find((group) => group.reviewGroupId === sourceGroupId);
  const targetGroup = session.groups.find((group) => group.reviewGroupId === targetGroupId);

  if (!sourceGroup || !targetGroup) {
    return addSessionWarning(session, 'Merge could not find both requested groups.');
  }

  const mergeOverride: ReviewOverride = {
    kind: 'group',
    action: 'merge',
    groupId: targetGroupId,
    affectedGroupIds: [sourceGroupId],
    warnings: []
  };
  const nextGroups = session.groups
    .filter((group) => group.reviewGroupId !== sourceGroupId)
    .map((group) => {
      if (group.reviewGroupId !== targetGroupId) {
        return group;
      }

      return {
        ...group,
        files: [...group.files, ...sourceGroup.files.map((file) => ({ ...file, fileId: file.fileId.replace(`${sourceGroupId}::`, `${targetGroupId}::merged::`) }))],
        overrides: [...group.overrides, mergeOverride],
        overrideWarnings: mergeWarnings(group.overrideWarnings, sourceGroup.overrideWarnings),
        warnings: mergeWarnings(group.warnings, sourceGroup.warnings),
        mergedGroupIds: [...group.mergedGroupIds, sourceGroup.reviewGroupId, ...sourceGroup.mergedGroupIds]
      };
    });

  return addSessionOverride(
    {
      ...session,
      groups: nextGroups
    },
    mergeOverride
  );
}

export function resetGroupOverrides(session: ReviewSession, groupId: string): ReviewSession {
  return updateGroupWithGroupOverride(session, groupId, 'reset', (group) => createReviewGroup(group.originalGroup, group.reviewGroupId));
}

export function buildReviewedDryRunPlan(session: ReviewSession, rootFolder: StemLibraryRoot): DryRunPlan {
  const groups = session.groups.map((group) => toReviewedStemGroup(group));
  const plannedFiles = session.groups.flatMap((group, groupIndex) =>
    group.files
      .filter((file) => file.included)
      .map((file): PlannedFile => {
        const targetRelativePath = [
          sanitizePathSegment(group.artistName),
          sanitizePathSegment(group.songFolderName),
          sanitizePathSegment(file.targetFilename)
        ].join('/');

        return {
          sourceFile: {
            ...file.originalFile,
            originalFilename: file.targetFilename,
            warnings: mergeWarnings(file.originalFile.warnings, file.overrideWarnings)
          },
          targetRelativePath,
          targetAbsolutePath: joinDomainPath(rootFolder.path, targetRelativePath),
          conflictStatus: 'not-checked',
          warnings: mergeWarnings(
            ['Conflict status is not checked in this dry-run foundation slice.'],
            [...group.overrideWarnings, ...file.overrideWarnings]
          )
        };
      })
  );
  // Per-group/per-file warnings (missing files, no stem evidence, sanitized overrides, etc.) are
  // surfaced on each card via ReviewGroupList/GroupList; they must not be duplicated into this
  // plan-level list, which is reserved for session/plan-wide facts shown once in the global footer.
  const warnings = mergeWarnings(session.sourcePlan.warnings, [
    ...session.warnings,
    plannedFiles.length === 0 ? 'No files are included in the reviewed dry-run plan.' : undefined
  ]);

  return {
    ...session.sourcePlan,
    stemLibraryRoot: rootFolder,
    targetDirectory: rootFolder.path,
    groups,
    plannedFiles,
    warnings,
    placeholderData: session.sourcePlan.placeholderData,
    createdAt: session.sourcePlan.createdAt
  };
}

function createReviewGroup(group: StemGroup, reviewGroupId = group.groupId): ReviewGroup {
  return {
    reviewGroupId,
    originalGroupId: group.groupId,
    originalGroup: group,
    artistName: group.artist,
    songFolderName: buildSongFolderName(group.canonicalSongTitle, group.bpm),
    status: 'needs-review',
    files: group.files.map((file, index) => createReviewFile(reviewGroupId, file, index, defaultFileIncluded(file))),
    overrides: [],
    overrideWarnings: [],
    warnings: group.warnings,
    mergedGroupIds: []
  };
}

function createReviewFile(groupId: string, file: TrackFile, index: number, included: boolean): ReviewFile {
  return {
    fileId: `${groupId}::file::${index}`,
    originalFile: file,
    originalFilename: file.originalFilename,
    targetFilename: file.originalFilename,
    included,
    overrideWarnings: [],
    warnings: file.warnings
  };
}

function defaultFileIncluded(file: TrackFile): boolean {
  return getDownloadCandidateClassification(file).role !== 'preview';
}

function toReviewedStemGroup(group: ReviewGroup): StemGroup {
  const includedFiles = group.files.filter((file) => file.included);
  const metadataSource = combineMetadataSource(group.originalGroup.metadataSource, group.originalGroup.uploads[0]?.metadataSource ?? 'unresolved');

  return {
    ...group.originalGroup,
    groupId: group.reviewGroupId,
    artist: group.artistName,
    canonicalSongTitle: group.songFolderName,
    files: includedFiles.map((file) => ({
      ...file.originalFile,
      originalFilename: file.targetFilename,
      warnings: mergeWarnings(file.originalFile.warnings, file.overrideWarnings)
    })),
    metadataSource,
    warnings: mergeWarnings(group.originalGroup.warnings, [...group.warnings, ...group.overrideWarnings])
  };
}

function updateGroup(session: ReviewSession, groupId: string, updater: (group: ReviewGroup) => ReviewGroup): ReviewSession {
  let found = false;
  const groups = session.groups.map((group) => {
    if (group.reviewGroupId !== groupId) {
      return group;
    }

    found = true;
    return updater(group);
  });

  return found ? { ...session, groups } : addSessionWarning(session, `Review group ${groupId} was not found.`);
}

function updateGroupWithGroupOverride(
  session: ReviewSession,
  groupId: string,
  action: 'split' | 'merge' | 'reset' | 'accept' | 'needs-review',
  updater: (group: ReviewGroup) => ReviewGroup
): ReviewSession {
  let groupOverride: ReviewOverride | undefined;
  const nextSession = updateGroup(session, groupId, (group) => {
    groupOverride = {
      kind: 'group',
      action,
      groupId,
      affectedGroupIds: [],
      warnings: []
    };
    const updatedGroup = updater(group);

    return {
      ...updatedGroup,
      overrides: [...updatedGroup.overrides, groupOverride]
    };
  });

  return groupOverride ? addSessionOverride(nextSession, groupOverride) : nextSession;
}

function updateFile(
  session: ReviewSession,
  fileId: string,
  updater: (file: ReviewFile) => ReviewFile,
  sessionOverride?: ReviewOverride
): ReviewSession {
  let found = false;
  const groups = session.groups.map((group) => ({
    ...group,
    files: group.files.map((file) => {
      if (file.fileId !== fileId) {
        return file;
      }

      found = true;
      return updater(file);
    })
  }));

  const nextSession = found ? { ...session, groups } : addSessionWarning(session, `Review file ${fileId} was not found.`);
  return found && sessionOverride ? addSessionOverride(nextSession, sessionOverride) : nextSession;
}

function setFileInclusion(session: ReviewSession, resolver: (file: ReviewFile) => boolean): ReviewSession {
  const overrides: ReviewOverride[] = [];
  const groups = session.groups.map((group) => ({
    ...group,
    files: group.files.map((file) => {
      const included = resolver(file);

      if (included !== file.included) {
        overrides.push({
          kind: 'file-selection',
          fileId: file.fileId,
          included,
          warnings: []
        });
      }

      return {
        ...file,
        included
      };
    })
  }));

  return {
    ...session,
    groups,
    overrides: [...session.overrides, ...overrides]
  };
}

function createRenameOverride(target: 'artist' | 'song' | 'file', targetId: string, originalValue: string, nextValue: string): ReviewOverride {
  const sanitizedValue = sanitizePathSegment(nextValue);
  const warnings = sanitizedValue !== nextValue ? [`${target} override "${nextValue}" will be sanitized to "${sanitizedValue}".`] : [];

  return {
    kind: 'rename',
    target,
    targetId,
    originalValue,
    nextValue,
    sanitizedValue,
    warnings
  };
}

function replaceOverride(overrides: ReviewOverride[], override: ReviewOverride): ReviewOverride[] {
  if (override.kind !== 'rename') {
    return [...overrides, override];
  }

  return [...overrides.filter((item) => item.kind !== 'rename' || item.target !== override.target || item.targetId !== override.targetId), override];
}

function addSessionOverride(session: ReviewSession, override: ReviewOverride): ReviewSession {
  return {
    ...session,
    overrides: [...session.overrides, override]
  };
}

function addSessionWarning(session: ReviewSession, warning: string): ReviewSession {
  return {
    ...session,
    warnings: mergeWarnings(session.warnings, [warning])
  };
}

function mergeWarnings(left: Array<string | undefined>, right: Array<string | undefined>): string[] {
  return [...left, ...right].filter((warning): warning is string => typeof warning === 'string' && warning.length > 0).filter(unique);
}

function combineMetadataSource(left: MetadataSourceType, right: MetadataSourceType): MetadataSourceType {
  if (left === 'html-enriched' || right === 'html-enriched') {
    return 'html-enriched';
  }

  if (left === 'api' || right === 'api') {
    return 'api';
  }

  if (left === 'fixture' || right === 'fixture') {
    return 'fixture';
  }

  return 'unresolved';
}

function joinDomainPath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/g, '');
  return `${normalizedRoot}/${relativePath}`;
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}
