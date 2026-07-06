import type { ArtistCatalogScanPhase, StemLibraryRoot } from '../../shared/domain';
import { t } from '../i18n';
import { resolveStatusBarRootLabel, type ArtistCatalogCounts } from './catalogStatus';

type Status = 'idle' | 'loading' | 'error';

export function StatusBar({
  stemLibraryRoot,
  onChooseRoot,
  isArtistCatalog,
  catalogCounts,
  scanPhase,
  plannedFileCount,
  downloadStatus
}: {
  stemLibraryRoot: StemLibraryRoot | null;
  onChooseRoot: () => void;
  isArtistCatalog: boolean;
  catalogCounts: ArtistCatalogCounts | null;
  scanPhase: ArtistCatalogScanPhase;
  plannedFileCount: number;
  downloadStatus: 'dry-run' | 'ready' | 'downloading';
  status: Status;
}): JSX.Element {
  const rootLabel = resolveStatusBarRootLabel(stemLibraryRoot);
  const progressText = isArtistCatalog && catalogCounts ? resolveProgressText(scanPhase, catalogCounts) : null;
  const foundText =
    catalogCounts && catalogCounts.downloadableGroupCount > 0
      ? `Found ${catalogCounts.downloadableGroupCount} song${catalogCounts.downloadableGroupCount === 1 ? '' : 's'} - ${catalogCounts.downloadableFileCount} file${catalogCounts.downloadableFileCount === 1 ? '' : 's'}`
      : null;
  const selectedText = plannedFileCount > 0 ? `${plannedFileCount} file${plannedFileCount === 1 ? '' : 's'} selected` : null;
  const stateText =
    downloadStatus === 'downloading'
      ? t('status.downloading')
      : downloadStatus === 'dry-run'
        ? t('status.dryRun')
        : t('status.ready');

  return (
    <footer className="status-bar" role="contentinfo">
      <button
        type="button"
        className="status-bar__root-button"
        onClick={onChooseRoot}
        title={stemLibraryRoot?.path ?? undefined}
        aria-label={stemLibraryRoot ? `Download folder: ${stemLibraryRoot.path}. Click to change folder.` : t('status.chooseFolder')}
      >
        <span className="status-bar__root-icon" aria-hidden="true">
          {stemLibraryRoot ? 'Folder' : 'Choose'}
        </span>
        <span className={`status-bar__root-path${stemLibraryRoot ? '' : ' unset'}`}>{rootLabel}</span>
      </button>

      <div className="status-bar__info">
        {progressText ? <span>{progressText}</span> : null}
        {foundText ? <span>{foundText}</span> : null}
        {selectedText ? <span>{selectedText}</span> : null}
        <span className="status-bar__note">{stateText}</span>
      </div>
    </footer>
  );
}

function resolveProgressText(scanPhase: ArtistCatalogScanPhase, counts: ArtistCatalogCounts): string {
  if (scanPhase === 'catalog') {
    return t('scan.catalog');
  }

  if (scanPhase === 'pages' || scanPhase === 'files') {
    const total = counts.totalUploadCount ?? counts.totalCount;
    return `${t('scan.pages')} ${counts.checkedUploadCount}${typeof total === 'number' ? ` of ${total}` : ''}`;
  }

  if (scanPhase === 'planning') {
    return t('scan.planning');
  }

  if (scanPhase === 'cancelled') {
    return t('scan.cancelled');
  }

  if (counts.loadedCount > 0) {
    return `${counts.loadedCount} upload${counts.loadedCount === 1 ? '' : 's'} checked`;
  }

  return t('status.ready');
}
