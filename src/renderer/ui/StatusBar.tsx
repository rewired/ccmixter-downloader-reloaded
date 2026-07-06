import type { MetadataSourceType, StemLibraryRoot } from '../../shared/domain';
import { resolveArtistCatalogStatus, resolveStatusBarRootLabel, type ArtistCatalogCounts } from './catalogStatus';

type Status = 'idle' | 'loading' | 'error';

export function StatusBar({
  stemLibraryRoot,
  onChooseRoot,
  isArtistCatalog,
  catalogCounts,
  catalogIsLoadingMore,
  hasMore,
  pagingIncomplete,
  sourceMode,
  plannedFileCount,
  status
}: {
  stemLibraryRoot: StemLibraryRoot | null;
  onChooseRoot: () => void;
  isArtistCatalog: boolean;
  catalogCounts: ArtistCatalogCounts | null;
  catalogIsLoadingMore: boolean;
  hasMore: boolean;
  pagingIncomplete: boolean;
  sourceMode: MetadataSourceType | null;
  plannedFileCount: number;
  status: Status;
}): JSX.Element {
  const rootLabel = resolveStatusBarRootLabel(stemLibraryRoot);
  const catalogStatusText = catalogCounts
    ? resolveArtistCatalogStatus(hasMore, catalogCounts.loadedCount, catalogCounts.totalCount, catalogIsLoadingMore, pagingIncomplete)
    : null;

  const infoText = !stemLibraryRoot
    ? 'Choose a folder before creating a dry run'
    : isArtistCatalog && catalogCounts
      ? `${catalogCounts.loadedCount}${typeof catalogCounts.totalCount === 'number' ? ` of ${catalogCounts.totalCount}` : ''} uploads loaded`
      : plannedFileCount > 0
        ? `${plannedFileCount} planned file${plannedFileCount === 1 ? '' : 's'}`
        : 'No plan yet';

  return (
    <footer className="status-bar" role="contentinfo">
      <button
        type="button"
        className="status-bar__root-button"
        onClick={onChooseRoot}
        disabled={status === 'loading'}
        title={stemLibraryRoot?.path ?? undefined}
        aria-label={
          stemLibraryRoot ? `Stem library root: ${stemLibraryRoot.path}. Click to change folder.` : 'Choose stem library root folder'
        }
      >
        <span className="status-bar__root-icon" aria-hidden="true">
          {stemLibraryRoot ? '📁' : '⚠️'}
        </span>
        <span className={`status-bar__root-path${stemLibraryRoot ? '' : ' unset'}`}>{rootLabel}</span>
      </button>

      <div className="status-bar__info">
        <span>{infoText}</span>
        {stemLibraryRoot && catalogStatusText ? <span>{catalogStatusText}</span> : null}
        {sourceMode ? <span>Source: {sourceMode}</span> : null}
        <span className="status-bar__note">Dry-run only</span>
      </div>
    </footer>
  );
}
