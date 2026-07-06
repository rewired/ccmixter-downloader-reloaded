import type { CcmixterInput, DryRunPlan, ResolvedCcmixterMetadata } from '../../shared/domain';
import { resolveArtistCatalogStatus, type ArtistCatalogCounts } from './catalogStatus';

export function TechnicalDetails({
  parsedInput,
  dryRunPlan,
  resolvedMetadata,
  catalogCounts,
  catalogIsLoadingMore,
  hasMore,
  pagingIncomplete
}: {
  parsedInput: CcmixterInput | null;
  dryRunPlan: DryRunPlan | null;
  resolvedMetadata: ResolvedCcmixterMetadata | null;
  catalogCounts: ArtistCatalogCounts | null;
  catalogIsLoadingMore: boolean;
  hasMore: boolean;
  pagingIncomplete: boolean;
}): JSX.Element {
  const catalogStatus = catalogCounts
    ? resolveArtistCatalogStatus(hasMore, catalogCounts.loadedCount, catalogCounts.totalCount, catalogIsLoadingMore, pagingIncomplete)
    : null;

  return (
    <details className="technical-details">
      <summary>Technical details</summary>
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
        <p className="empty">Enter a ccMixter input and scan to see the local interpretation.</p>
      )}

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
            <dt>Total uploads</dt>
            <dd>{typeof catalogCounts.totalCount === 'number' ? catalogCounts.totalCount : 'unknown'}</dd>
          </div>
          <div>
            <dt>Has more</dt>
            <dd>{hasMore ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt>Planned files</dt>
            <dd>{catalogCounts.plannedFileCount}</dd>
          </div>
          <div>
            <dt>Included files</dt>
            <dd>{catalogCounts.includedFileCount}</dd>
          </div>
          {catalogStatus ? (
            <div>
              <dt>Status</dt>
              <dd>{catalogStatus}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </details>
  );
}
