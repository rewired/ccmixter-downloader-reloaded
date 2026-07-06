import type {
  ArtistCatalogState,
  DryRunPlan,
  ResolvedCcmixterMetadata,
  ReviewGroup,
  StemGroup,
  StemLibraryRoot
} from '../../shared/domain';

export interface ArtistCatalogCounts {
  loadedCount: number;
  totalCount?: number;
  checkedUploadCount: number;
  totalUploadCount?: number;
  plannedFileCount: number;
  includedFileCount: number;
  downloadableGroupCount: number;
  downloadableFileCount: number;
  noFilesFoundCount: number;
  couldNotCheckFilesCount: number;
}

export function resolveArtistCatalogCounts(
  catalogSessionState: ArtistCatalogState | null,
  resolvedMetadata: ResolvedCcmixterMetadata | null,
  dryRunPlan: DryRunPlan | null,
  reviewedDryRunPlan: DryRunPlan | null
): ArtistCatalogCounts | null {
  if (catalogSessionState) {
    return {
      loadedCount: catalogSessionState.loadedCount,
      totalCount: catalogSessionState.totalCount,
      checkedUploadCount: catalogSessionState.checkedUploadCount,
      totalUploadCount: catalogSessionState.totalUploadCount,
      plannedFileCount: reviewedDryRunPlan?.plannedFiles.length ?? dryRunPlan?.plannedFiles.length ?? resolvedMetadata?.files.length ?? 0,
      includedFileCount: reviewedDryRunPlan?.plannedFiles.length ?? 0,
      downloadableGroupCount: catalogSessionState.downloadableGroupCount,
      downloadableFileCount: catalogSessionState.downloadableFileCount,
      noFilesFoundCount: catalogSessionState.noFilesFoundCount,
      couldNotCheckFilesCount: catalogSessionState.couldNotCheckFilesCount
    };
  }

  if (dryRunPlan || resolvedMetadata) {
    const uploadIds = new Set(
      (dryRunPlan?.groups.flatMap((group) => group.uploads) ?? resolvedMetadata?.uploads ?? []).map((upload) => upload.uploadId)
    );

    return {
      loadedCount: uploadIds.size,
      totalCount: undefined,
      checkedUploadCount: uploadIds.size,
      totalUploadCount: undefined,
      plannedFileCount: dryRunPlan?.plannedFiles.length ?? resolvedMetadata?.files.length ?? 0,
      includedFileCount: reviewedDryRunPlan?.plannedFiles.length ?? 0,
      downloadableGroupCount: dryRunPlan?.groups.length ?? resolvedMetadata?.groups.length ?? 0,
      downloadableFileCount: dryRunPlan?.groups.reduce((sum, group) => sum + group.files.length, 0) ?? resolvedMetadata?.files.length ?? 0,
      noFilesFoundCount: 0,
      couldNotCheckFilesCount: 0
    };
  }

  return null;
}

export function resolveArtistCatalogStatus(
  hasMore: boolean,
  loadedCount: number,
  totalCount: number | undefined,
  catalogIsLoadingMore: boolean,
  pagingIncomplete = false
): string | null {
  if (catalogIsLoadingMore) {
    return 'Loading more uploads…';
  }

  if (pagingIncomplete) {
    return `Catalog incomplete: ${loadedCount}${typeof totalCount === 'number' ? ` of ${totalCount}` : ''} loaded`;
  }

  if (hasMore) {
    return loadedCount > 0 ? 'More uploads available' : null;
  }

  if (loadedCount > 0) {
    // Only claim completion when the loaded count actually reaches the known total (or no total is
    // known and the source itself reported it was exhausted) - never on a paging source giving up early.
    if (typeof totalCount === 'number' && loadedCount < totalCount) {
      return `${loadedCount} of ${totalCount} loaded`;
    }
    return `All ${typeof totalCount === 'number' ? totalCount : loadedCount} uploads loaded`;
  }

  return null;
}

export function resolveStatusBarRootLabel(root: StemLibraryRoot | null): string {
  return root?.path ?? 'Choose download folder';
}

export interface WarningTiers {
  global: string[];
  selected: string[];
}

export function selectWarningTiers(
  globalWarnings: string[],
  selectedGroup: ReviewGroup | StemGroup | null
): WarningTiers {
  if (!selectedGroup) {
    return { global: globalWarnings, selected: [] };
  }

  const selected =
    'overrideWarnings' in selectedGroup ? [...selectedGroup.overrideWarnings, ...selectedGroup.warnings] : [...selectedGroup.warnings];

  return { global: globalWarnings, selected };
}
