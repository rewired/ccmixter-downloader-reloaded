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
  plannedFileCount: number;
  includedFileCount: number;
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
      plannedFileCount: reviewedDryRunPlan?.plannedFiles.length ?? dryRunPlan?.plannedFiles.length ?? resolvedMetadata?.files.length ?? 0,
      includedFileCount: reviewedDryRunPlan?.plannedFiles.length ?? 0
    };
  }

  if (dryRunPlan || resolvedMetadata) {
    const uploadIds = new Set(
      (dryRunPlan?.groups.flatMap((group) => group.uploads) ?? resolvedMetadata?.uploads ?? []).map((upload) => upload.uploadId)
    );

    return {
      loadedCount: uploadIds.size,
      totalCount: undefined,
      plannedFileCount: dryRunPlan?.plannedFiles.length ?? resolvedMetadata?.files.length ?? 0,
      includedFileCount: reviewedDryRunPlan?.plannedFiles.length ?? 0
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
  return root?.path ?? 'Stem library not set';
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
