import type { CcmixterInput, DryRunPlan, ResolvedCcmixterMetadata } from '../../shared/domain';
import { t } from '../i18n';
import { resolveArtistCatalogStatus, type ArtistCatalogCounts } from './catalogStatus';

type Status = 'idle' | 'loading' | 'error';

export function TechnicalDetails({
  parsedInput,
  dryRunPlan,
  resolvedMetadata,
  catalogCounts,
  catalogIsLoadingMore,
  hasMore,
  pagingIncomplete,
  onParseInput,
  onResolveMetadata,
  status
}: {
  parsedInput: CcmixterInput | null;
  dryRunPlan: DryRunPlan | null;
  resolvedMetadata: ResolvedCcmixterMetadata | null;
  catalogCounts: ArtistCatalogCounts | null;
  catalogIsLoadingMore: boolean;
  hasMore: boolean;
  pagingIncomplete: boolean;
  onParseInput: () => void;
  onResolveMetadata: () => void;
  status: Status;
}): JSX.Element {
  const catalogStatus = catalogCounts
    ? resolveArtistCatalogStatus(hasMore, catalogCounts.loadedCount, catalogCounts.totalCount, catalogIsLoadingMore, pagingIncomplete)
    : null;
  const warnings = [...(parsedInput?.warnings ?? []), ...(dryRunPlan?.warnings ?? resolvedMetadata?.warnings ?? [])].filter(unique);

  return (
    <details className="technical-details">
      <summary>{t('technical.title')}</summary>

      <section className="technical-section">
        <h3>{t('technical.scanDetails')}</h3>
        {catalogCounts ? (
          <dl className="details compact artist-catalog-counts" aria-label="Artist catalog scan counts">
            <div>
              <dt>Loaded uploads</dt>
              <dd>
                {catalogCounts.loadedCount}
                {typeof catalogCounts.totalCount === 'number' ? ` of ${catalogCounts.totalCount}` : ''}
              </dd>
            </div>
            <div>
              <dt>Checked upload pages</dt>
              <dd>
                {catalogCounts.checkedUploadCount}
                {typeof catalogCounts.totalUploadCount === 'number' ? ` of ${catalogCounts.totalUploadCount}` : ''}
              </dd>
            </div>
            <div>
              <dt>Downloadable files</dt>
              <dd>{catalogCounts.downloadableFileCount}</dd>
            </div>
            <div>
              <dt>Could not check</dt>
              <dd>{catalogCounts.couldNotCheckFilesCount}</dd>
            </div>
            {catalogStatus ? (
              <div>
                <dt>Status</dt>
                <dd>{catalogStatus}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="empty">No scan details yet.</p>
        )}
      </section>

      <section className="technical-section">
        <h3>{t('technical.warnings')}</h3>
        {warnings.length > 0 ? (
          <ul className="warning-list">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p className="empty">No warnings.</p>
        )}
      </section>

      <section className="technical-section">
        <h3>{t('technical.rawDetails')}</h3>
        {parsedInput ? (
          <dl className="details compact">
            <div>
              <dt>Kind</dt>
              <dd>{parsedInput.kind}</dd>
            </div>
            <div>
              <dt>Artist login</dt>
              <dd>{parsedInput.artistLogin ?? parsedInput.normalizedArtistLogin ?? 'not specified'}</dd>
            </div>
            <div>
              <dt>Upload ID</dt>
              <dd>{parsedInput.uploadId ?? 'not specified'}</dd>
            </div>
            <div>
              <dt>Resolver status</dt>
              <dd>{dryRunPlan?.resolverStatus ?? resolvedMetadata?.status ?? 'not run'}</dd>
            </div>
            <div>
              <dt>Source type</dt>
              <dd>{dryRunPlan?.metadataSource ?? resolvedMetadata?.metadataSource ?? 'unresolved'}</dd>
            </div>
          </dl>
        ) : (
          <p className="empty">No parsed input yet.</p>
        )}
      </section>

      <section className="technical-section">
        <h3>{t('technical.developerActions')}</h3>
        <div className="source-panel__dev-buttons">
          <button type="button" className="secondary" onClick={onParseInput} disabled={status === 'loading'}>
            {t('technical.parseInput')}
          </button>
          <button type="button" className="secondary" onClick={onResolveMetadata} disabled={status === 'loading'}>
            {t('technical.resolveMetadata')}
          </button>
        </div>
      </section>
    </details>
  );
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}
