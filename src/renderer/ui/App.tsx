import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ARTIST_SCAN_REALITY_CHECK_WARNING,
  buildReviewedDryRunPlan,
  clearIncludedDownloadCandidates,
  createDownloadJobFromReviewedPlan,
  createDryRunPlanFromGroups,
  createReviewSessionFromDryRunPlan,
  excludeArchiveDownloadCandidates,
  excludePreviewDownloadCandidates,
  getDownloadCandidateClassification,
  includeRecommendedDownloadCandidates,
  isArtistCatalogInput,
  markGroupAccepted,
  markGroupNeedsReview,
  mergeGroups,
  renameArtist,
  renameFile,
  renameGroup,
  resetGroupOverrides,
  splitGroup,
  summarizeDownloadJob,
  toggleFileIncluded,
  validateDownloadJob,
  type AppError,
  type ArchivePreview,
  type ArtistCatalogState,
  type CcmixterInput,
  type DownloadJob,
  type DownloadQueueState,
  type DownloadResult,
  type DryRunPlan,
  type ResolvedCcmixterMetadata,
  type ReviewGroup,
  type ReviewFile,
  type ReviewSession,
  type StemGroup,
  type StemLibraryRoot
} from '../../shared/domain';
import type { AppInfo } from '../../shared/ipc';

type Status = 'idle' | 'loading' | 'error';

const DOWNLOAD_WARNING = 'Downloads start only after review and explicit confirmation.';

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [rawInput, setRawInput] = useState('https://ccmixter.org/files/sample_artist/000000');
  const [stemLibraryRoot, setStemLibraryRoot] = useState<StemLibraryRoot | null>(null);
  const [parsedInput, setParsedInput] = useState<CcmixterInput | null>(null);
  const [resolvedMetadata, setResolvedMetadata] = useState<ResolvedCcmixterMetadata | null>(null);
  const [dryRunPlan, setDryRunPlan] = useState<DryRunPlan | null>(null);
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [downloadJob, setDownloadJob] = useState<DownloadJob | null>(null);
  const [downloadQueueState, setDownloadQueueState] = useState<DownloadQueueState | null>(null);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const [archivePreviews, setArchivePreviews] = useState<Record<string, ArchivePreview>>({});
  const [archivePreviewErrors, setArchivePreviewErrors] = useState<Record<string, string>>({});
  const [catalogSessionState, setCatalogSessionState] = useState<ArtistCatalogState | null>(null);
  const [catalogIsLoadingMore, setCatalogIsLoadingMore] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialState(): Promise<void> {
      try {
        const [info, persistedRoot] = await Promise.all([
          window.ccmixterDownloader.getAppInfo(),
          window.ccmixterDownloader.getStemLibraryRoot()
        ]);

        if (isMounted) {
          setAppInfo(info);
          setStemLibraryRoot(persistedRoot);
          setStatus('idle');
        }
      } catch (loadError) {
        if (isMounted) {
          setError(toAppError(loadError));
          setStatus('error');
        }
      }
    }

    void loadInitialState();

    return () => {
      isMounted = false;
    };
  }, []);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMoreRef = useRef(false);

  const handleLoadMoreCatalog = useCallback(async (): Promise<void> => {
    if (!catalogSessionState || !catalogSessionState.hasMore) {
      return;
    }

    isLoadingMoreRef.current = true;
    setCatalogIsLoadingMore(true);

    try {
      const result = await window.ccmixterDownloader.artistCatalogLoadMore(catalogSessionState.sessionId);

      if (!result.ok) {
        setError(result.error);
        isLoadingMoreRef.current = false;
        setCatalogIsLoadingMore(false);
        return;
      }

      const page = result.value;

      setCatalogSessionState((prev) =>
        prev
          ? {
              ...prev,
              loadedCount: page.loadedCount,
              hasMore: page.hasMore,
              totalCount: page.totalCount ?? prev.totalCount,
              groups: page.groups
            }
          : null
      );

      isLoadingMoreRef.current = false;
      setCatalogIsLoadingMore(false);

      if (reviewSession && stemLibraryRoot) {
        const root = stemLibraryRoot;
        const plan = createDryRunPlanFromGroups(rawInput, root, page.groups, {
          metadataSource: 'api',
          placeholderData: false,
          resolverStatus: page.hasMore ? 'partial' : 'resolved',
          warnings: page.warnings
        });

        const newSession = createReviewSessionFromDryRunPlan(plan);

        const mergedGroups = newSession.groups.map((newGroup) => {
          const existingGroup = reviewSession.groups.find(
            (g) => g.originalGroupId === newGroup.originalGroupId
          );
          return existingGroup ?? newGroup;
        });

        setReviewSession({
          ...newSession,
          groups: mergedGroups
        });
      }
    } catch (err) {
      setError(toAppError(err));
      isLoadingMoreRef.current = false;
      setCatalogIsLoadingMore(false);
    }
  }, [catalogSessionState, reviewSession, stemLibraryRoot, rawInput]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !catalogSessionState?.hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && catalogSessionState?.hasMore && !isLoadingMoreRef.current) {
          void handleLoadMoreCatalog();
        }
      },
      { rootMargin: '300px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [catalogSessionState?.hasMore, handleLoadMoreCatalog]);

  useEffect(() => {
    const removeProgressListener = window.ccmixterDownloader.onDownloadProgress((progress) => {
      setDownloadQueueState((current) =>
        current && current.jobId === progress.jobId
          ? {
              ...current,
              status: progress.status,
              progress,
              files: current.files.map((file) =>
                file.fileJobId === progress.fileJobId
                  ? {
                      ...file,
                      status: progress.status === 'running' ? 'running' : file.status,
                      receivedBytes: progress.receivedBytes ?? file.receivedBytes,
                      totalBytes: progress.totalBytes ?? file.totalBytes
                    }
                  : file
              )
            }
          : current
      );
    });
    const removeCompletedListener = window.ccmixterDownloader.onDownloadCompleted((result) => {
      setDownloadResult(result);
    });

    return () => {
      removeProgressListener();
      removeCompletedListener();
    };
  }, []);

  async function chooseStemLibraryRoot(): Promise<void> {
    setStatus('loading');
    setError(null);

    try {
      const result = await window.ccmixterDownloader.chooseStemLibraryRoot();
      if (!result.cancelled) {
        setStemLibraryRoot(result.root);
        setDryRunPlan(null);
        setResolvedMetadata(null);
        setReviewSession(null);
        resetDownloadState();
      }

      setStatus('idle');
    } catch (chooseError) {
      setError(toAppError(chooseError));
      setStatus('error');
    }
  }

  async function parseInput(): Promise<void> {
    setStatus('loading');
    setError(null);

    try {
      const parsed = await window.ccmixterDownloader.parseInput(rawInput);
      setParsedInput(parsed);
      setResolvedMetadata(null);
      setReviewSession(null);
      resetDownloadState();
      setStatus('idle');
    } catch (parseError) {
      setError(toAppError(parseError));
      setStatus('error');
    }
  }

  async function resolveMetadata(): Promise<void> {
    setStatus('loading');
    setError(null);

    try {
      const metadataResult = await window.ccmixterDownloader.resolveMetadata(rawInput);

      if (!metadataResult.ok) {
        setError(metadataResult.error);
        setStatus('error');
        return;
      }

      setParsedInput(metadataResult.value.input);
      setResolvedMetadata(metadataResult.value);
      setDryRunPlan(null);
      setReviewSession(null);
      resetDownloadState();
      setStatus('idle');
    } catch (resolveError) {
      setError(toAppError(resolveError));
      setStatus('error');
    }
  }

  async function startArtistCatalog(): Promise<void> {
    setStatus('loading');
    setError(null);
    setCatalogSessionState(null);

    try {
      if (!parsedInput?.artistLogin) {
        setError({ code: 'NO_ARTIST_LOGIN', message: 'Artist login could not be determined.', recoverable: true });
        setStatus('error');
        return;
      }

      if (!stemLibraryRoot) {
        setError({ code: 'STEM_LIBRARY_ROOT_REQUIRED', message: 'Choose a Stem Library Root Folder before reviewing uploads.', recoverable: true });
        setStatus('error');
        return;
      }

      const result = await window.ccmixterDownloader.artistCatalogStart(
        parsedInput.artistLogin,
        parsedInput.sourceUrl
      );

      if (!result.ok) {
        setError(result.error);
        setStatus('error');
        return;
      }

      const state = result.value;
      setCatalogSessionState(state);

      const plan = createDryRunPlanFromGroups(rawInput, stemLibraryRoot, state.groups, {
        metadataSource: 'api',
        placeholderData: false,
        resolverStatus: state.hasMore ? 'partial' : 'resolved',
        warnings: state.warnings
      });

      setParsedInput(plan.input);
      setResolvedMetadata(null);
      setDryRunPlan(plan);
      setReviewSession(createReviewSessionFromDryRunPlan(plan));
      resetDownloadState();
      setStatus('idle');
    } catch (err) {
      setError(toAppError(err));
      setStatus('error');
    }
  }

  async function createDryRunPlan(): Promise<void> {
    setStatus('loading');
    setError(null);

    try {
      const planResult = await window.ccmixterDownloader.createDryRunPlan(rawInput, stemLibraryRoot);

      if (!planResult.ok) {
        setError(planResult.error);
        setStatus('error');
        return;
      }

      setParsedInput(planResult.value.input);
      setResolvedMetadata(null);
      setDryRunPlan(planResult.value);
      setReviewSession(createReviewSessionFromDryRunPlan(planResult.value));
      resetDownloadState();
      setStatus('idle');
    } catch (planError) {
      setError(toAppError(planError));
      setStatus('error');
    }
  }

  async function prepareDownloadJob(reviewedPlan: DryRunPlan): Promise<void> {
    setStatus('loading');
    setError(null);
    setDownloadResult(null);

    try {
      const jobResult = await window.ccmixterDownloader.createDownloadJob(reviewedPlan);

      if (!jobResult.ok) {
        setError(jobResult.error);
        setStatus('error');
        return;
      }

      setDownloadJob(jobResult.value);
      setDownloadQueueState(null);
      setStatus('idle');
    } catch (downloadError) {
      setError(toAppError(downloadError));
      setStatus('error');
    }
  }

  async function confirmDownloadJob(jobId: string): Promise<void> {
    setStatus('loading');
    setError(null);
    if (downloadJob && downloadJob.jobId === jobId) {
      setDownloadQueueState(toInitialDownloadQueueState(downloadJob));
    }

    try {
      const startResult = await window.ccmixterDownloader.startDownloadJob(jobId);

      if (!startResult.ok) {
        setError(startResult.error);
        setStatus('error');
        return;
      }

      setDownloadQueueState(startResult.value);
      setStatus('idle');
    } catch (downloadError) {
      setError(toAppError(downloadError));
      setStatus('error');
    }
  }

  async function cancelDownloadJob(jobId: string): Promise<void> {
    setError(null);

    try {
      const cancelResult = await window.ccmixterDownloader.cancelDownloadJob(jobId);

      if (!cancelResult.ok) {
        setError(cancelResult.error);
        setStatus('error');
        return;
      }

      setDownloadQueueState(cancelResult.value);
      setStatus('idle');
    } catch (downloadError) {
      setError(toAppError(downloadError));
      setStatus('error');
    }
  }

  async function previewArchiveDownload(jobId: string, fileJobId: string): Promise<void> {
    setError(null);
    setArchivePreviewErrors((current) => {
      const next = { ...current };
      delete next[fileJobId];
      return next;
    });

    try {
      const result = await window.ccmixterDownloader.previewArchiveDownload(jobId, fileJobId);

      if (!result.ok) {
        setArchivePreviewErrors((current) => ({ ...current, [fileJobId]: result.error.message }));
        return;
      }

      setArchivePreviews((current) => ({ ...current, [fileJobId]: result.value }));
    } catch (previewError) {
      setArchivePreviewErrors((current) => ({ ...current, [fileJobId]: toAppError(previewError).message }));
    }
  }

  function resetDownloadState(): void {
    setDownloadJob(null);
    setDownloadQueueState(null);
    setDownloadResult(null);
    setArchivePreviews({});
    setArchivePreviewErrors({});
  }

  const canCreateDryRun = stemLibraryRoot !== null && rawInput.trim().length > 0 && status !== 'loading';
  const reviewedDryRunPlan = useMemo(
    () => (dryRunPlan && reviewSession ? buildReviewedDryRunPlan(reviewSession, dryRunPlan.stemLibraryRoot) : dryRunPlan),
    [dryRunPlan, reviewSession]
  );
  const advisoryDownloadJob = useMemo(
    () => (reviewedDryRunPlan ? createDownloadJobFromReviewedPlan(reviewedDryRunPlan, { jobId: 'renderer-advisory-job' }) : null),
    [reviewedDryRunPlan]
  );
  const advisoryDownloadValidation = advisoryDownloadJob ? validateDownloadJob(advisoryDownloadJob) : null;
  const advisoryDownloadSummary = advisoryDownloadJob ? summarizeDownloadJob(advisoryDownloadJob) : null;
  const activeInput = dryRunPlan?.input ?? resolvedMetadata?.input ?? parsedInput;
  const isArtistCatalog = activeInput ? isArtistCatalogInput(activeInput) : false;
  const catalogCounts = isArtistCatalog ? resolveArtistCatalogCounts(catalogSessionState, resolvedMetadata, dryRunPlan, reviewedDryRunPlan) : null;
  const canPrepareDownload =
    Boolean(stemLibraryRoot && reviewedDryRunPlan && advisoryDownloadValidation?.ok && advisoryDownloadSummary && advisoryDownloadSummary.writableFiles > 0) &&
    status !== 'loading';

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="app-header">
          <div>
            <p className="eyebrow">Stem library planner</p>
            <h1>{appInfo?.name ?? 'ccMixter Stem Downloader'}</h1>
          </div>
          <span className="version">v{appInfo?.version ?? '0.1.0'}</span>
        </header>

        <section className="banner" role="status">
          <strong>{DOWNLOAD_WARNING}</strong>
          <span>No ZIP extraction or attribution writing happens in this slice.</span>
        </section>

        {isArtistCatalog ? (
          <section className="banner artist-scan-banner" role="status">
            <strong>Review artist uploads</strong>
            <span>{ARTIST_SCAN_REALITY_CHECK_WARNING}</span>
            {catalogCounts ? <ArtistCatalogCounts counts={catalogCounts} catalogIsLoadingMore={catalogIsLoadingMore} hasMore={catalogSessionState?.hasMore ?? false} /> : null}
          </section>
        ) : null}

        <section className="controls" aria-label="Dry run controls">
          <label className="field">
            <span>ccMixter artist, upload link, or upload ID</span>
            <input
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder="https://ccmixter.org/files/artist/12345"
            />
          </label>

          <div className="root-folder">
            <div>
              <span className="field-label">Stem Library Root Folder</span>
              <strong>{stemLibraryRoot?.path ?? 'No root folder selected'}</strong>
            </div>
            <button type="button" onClick={() => void chooseStemLibraryRoot()} disabled={status === 'loading'}>
              Choose Stem Library Root Folder
            </button>
          </div>

          <div className="actions">
            <button type="button" className="secondary" onClick={() => void parseInput()} disabled={status === 'loading'}>
              Parse input
            </button>
            <button type="button" className="secondary" onClick={() => void resolveMetadata()} disabled={status === 'loading'}>
              Resolve metadata
            </button>
            <button
              type="button"
              onClick={() => void (isArtistCatalog ? startArtistCatalog() : createDryRunPlan())}
              disabled={!canCreateDryRun}
            >
              {isArtistCatalog ? 'Review artist uploads' : 'Create dry run'}
            </button>
          </div>
        </section>

        {status === 'loading' ? <p className="state">Working...</p> : null}
        {error ? (
          <section className="error" role="alert">
            <strong>{error.message}</strong>
            <span>{error.recoverable ? 'You can adjust the input or root folder and try again.' : 'Restart may be required.'}</span>
          </section>
        ) : null}

        <section className="results" aria-label="Dry run preview">
          <article className="panel">
            <h2>Parsed input</h2>
            {parsedInput ? (
              <dl className="details">
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
              <p className="empty">Enter a ccMixter input and parse it to see the local interpretation.</p>
            )}
          </article>

          <article className="panel preview-panel">
            <h2>{isArtistCatalog ? 'Review artist uploads' : 'Planned paths below root folder'}</h2>
            {dryRunPlan ? (
              <>
                <p className="root-path">{dryRunPlan.stemLibraryRoot.path}</p>
                {catalogCounts ? <ArtistCatalogCounts counts={catalogCounts} catalogIsLoadingMore={catalogIsLoadingMore} hasMore={catalogSessionState?.hasMore ?? false} /> : null}
                {reviewSession ? (
                  <ReviewGroupList reviewSession={reviewSession} onChange={setReviewSession} />
                ) : (
                  <GroupList groups={dryRunPlan.groups} />
                )}
                {isArtistCatalog ? <div ref={sentinelRef} id="catalog-scroll-sentinel" /> : null}
                <ul className="path-list">
                  {reviewedDryRunPlan?.plannedFiles.map((file, index) => (
                    <li key={`${file.targetRelativePath}-${index}`}>
                      <span>{file.targetRelativePath}</span>
                    </li>
                  ))}
                </ul>
                <ul className="warning-list">
                  {reviewedDryRunPlan?.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                {reviewedDryRunPlan && advisoryDownloadJob && advisoryDownloadSummary && advisoryDownloadValidation ? (
                  <DownloadPanel
                    advisoryJob={advisoryDownloadJob}
                    advisorySummary={advisoryDownloadSummary}
                    advisoryValidationOk={advisoryDownloadValidation.ok}
                    canPrepareDownload={canPrepareDownload}
                    downloadJob={downloadJob}
                    downloadQueueState={downloadQueueState}
                    downloadResult={downloadResult}
                    archivePreviews={archivePreviews}
                    archivePreviewErrors={archivePreviewErrors}
                    isArtistCatalog={isArtistCatalog}
                    onCancel={(jobId) => void cancelDownloadJob(jobId)}
                    onConfirm={(jobId) => void confirmDownloadJob(jobId)}
                    onPrepare={() => void prepareDownloadJob(reviewedDryRunPlan)}
                    onPreviewArchive={(jobId, fileJobId) => void previewArchiveDownload(jobId, fileJobId)}
                    status={status}
                  />
                ) : null}
              </>
            ) : resolvedMetadata ? (
              <>
                <GroupList groups={resolvedMetadata.groups} />
                {catalogCounts ? <ArtistCatalogCounts counts={catalogCounts} catalogIsLoadingMore={catalogIsLoadingMore} hasMore={catalogSessionState?.hasMore ?? false} /> : null}
                {resolvedMetadata.warnings.length > 0 ? (
                  <ul className="warning-list">
                    {resolvedMetadata.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="empty">
                Choose a Stem Library Root Folder, then create a dry run to preview artist/song/file paths.
              </p>
            )}
          </article>
        </section>
      </section>
    </main>
  );
}

interface ArtistCatalogCounts {
  loadedCount: number;
  totalCount?: number;
  plannedFileCount: number;
  includedFileCount: number;
}

function resolveArtistCatalogCounts(
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
  catalogIsLoadingMore: boolean
): string | null {
  if (catalogIsLoadingMore) {
    return 'Loading more uploads…';
  }

  if (hasMore) {
    return loadedCount > 0 ? 'More uploads available' : null;
  }

  if (loadedCount > 0) {
    return `All ${typeof totalCount === 'number' ? totalCount : loadedCount} uploads loaded`;
  }

  return null;
}

function ArtistCatalogCounts({
  counts,
  catalogIsLoadingMore,
  hasMore
}: {
  counts: ArtistCatalogCounts;
  catalogIsLoadingMore: boolean;
  hasMore: boolean;
}): JSX.Element {
  const status = resolveArtistCatalogStatus(hasMore, counts.loadedCount, counts.totalCount, catalogIsLoadingMore);

  return (
    <dl className="details compact artist-catalog-counts" aria-label="Artist catalog scan counts">
      <div>
        <dt>Loaded uploads</dt>
        <dd>
          {counts.loadedCount}
          {typeof counts.totalCount === 'number' ? ` of ${counts.totalCount}` : ''}
        </dd>
      </div>
      <div>
        <dt>Total uploads</dt>
        <dd>{typeof counts.totalCount === 'number' ? counts.totalCount : 'unknown'}</dd>
      </div>
      <div>
        <dt>Has more</dt>
        <dd>{hasMore ? 'true' : 'false'}</dd>
      </div>
      <div>
        <dt>Planned files</dt>
        <dd>{counts.plannedFileCount}</dd>
      </div>
      <div>
        <dt>Included files</dt>
        <dd>{counts.includedFileCount}</dd>
      </div>
      {status ? <div><dt>Status</dt><dd>{status}</dd></div> : null}
    </dl>
  );
}

function DownloadPanel({
  advisoryJob,
  advisorySummary,
  advisoryValidationOk,
  canPrepareDownload,
  downloadJob,
  downloadQueueState,
  downloadResult,
  archivePreviews,
  archivePreviewErrors,
  isArtistCatalog,
  onCancel,
  onConfirm,
  onPrepare,
  onPreviewArchive,
  status
}: {
  advisoryJob: DownloadJob;
  advisorySummary: ReturnType<typeof summarizeDownloadJob>;
  advisoryValidationOk: boolean;
  canPrepareDownload: boolean;
  downloadJob: DownloadJob | null;
  downloadQueueState: DownloadQueueState | null;
  downloadResult: DownloadResult | null;
  archivePreviews: Record<string, ArchivePreview>;
  archivePreviewErrors: Record<string, string>;
  isArtistCatalog: boolean;
  onCancel: (jobId: string) => void;
  onConfirm: (jobId: string) => void;
  onPrepare: () => void;
  onPreviewArchive: (jobId: string, fileJobId: string) => void;
  status: Status;
}): JSX.Element {
  const jobForSummary = downloadJob ?? advisoryJob;
  const summary = downloadJob ? summarizeDownloadJob(downloadJob) : advisorySummary;
  const canConfirm =
    downloadJob !== null &&
    downloadJob.status === 'queued' &&
    summarizeDownloadJob(downloadJob).writableFiles > 0 &&
    downloadJob.errors.length === 0 &&
    status !== 'loading';
  const isRunning = downloadQueueState?.status === 'running';

  return (
    <section className="download-panel" aria-label="Download confirmation and progress">
      <div className="download-heading">
        <div>
          <h3>Download</h3>
          <span>{summary.writableFiles} writable file(s)</span>
        </div>
        <span className={`source-badge status-${downloadQueueState?.status ?? downloadJob?.status ?? 'queued'}`}>
          {downloadQueueState?.status ?? downloadJob?.status ?? 'not prepared'}
        </span>
      </div>

      <dl className="details compact">
        <div>
          <dt>Target root</dt>
          <dd>{summary.targetRoot}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{summary.skippedFiles}</dd>
        </div>
        <div>
          <dt>Blocked files</dt>
          <dd>{summary.blockedFiles}</dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>{summary.warnings.length}</dd>
        </div>
        <div>
          <dt>Blocking errors</dt>
          <dd>{advisoryValidationOk ? summary.errors.length : 'blocking'}</dd>
        </div>
      </dl>

      <div className="download-actions">
        <button type="button" onClick={onPrepare} disabled={!canPrepareDownload}>
          {isArtistCatalog ? 'Prepare selected uploads' : 'Start Download'}
        </button>
        <button type="button" className="secondary" onClick={() => onConfirm(downloadJob!.jobId)} disabled={!canConfirm}>
          Confirm Download
        </button>
        <button type="button" className="secondary" onClick={() => onCancel(downloadQueueState!.jobId)} disabled={!isRunning}>
          Cancel
        </button>
      </div>

      {downloadJob && !downloadQueueState ? (
        <p className="confirmation-note">
          Confirm to write {summary.writableFiles} file(s) under {downloadJob.stemLibraryRootPath}.
        </p>
      ) : null}

      <ul className="path-list download-file-list">
        {jobForSummary.files.map((file) => {
          const stateFile = downloadQueueState?.files.find((candidate) => candidate.fileJobId === file.fileJobId);
          const displayFile = stateFile ?? file;
          const archivePreview = archivePreviews[file.fileJobId];
          const archivePreviewError = archivePreviewErrors[file.fileJobId];

          return (
            <li key={file.fileJobId}>
              <span>{file.targetRelativePath}</span>
              <small>
                {displayFile.status}
                {typeof displayFile.receivedBytes === 'number' ? ` / ${formatBytes(displayFile.receivedBytes)}` : ''}
                {typeof displayFile.totalBytes === 'number' ? ` of ${formatBytes(displayFile.totalBytes)}` : ''}
                {typeof displayFile.totalBytes !== 'number' ? ' / total unknown' : ''}
              </small>
              {file.fileKind === 'archive' ? (
                <div className="archive-preview-actions">
                  <button
                    type="button"
                    className="secondary compact-button"
                    onClick={() => onPreviewArchive(jobForSummary.jobId, file.fileJobId)}
                    disabled={!downloadJob || status === 'loading'}
                  >
                    Preview archive contents
                  </button>
                  <span>Archive preview is informational; extraction is not implemented yet.</span>
                </div>
              ) : null}
              {archivePreviewError ? <p className="archive-preview-error">{archivePreviewError}</p> : null}
              {archivePreview ? <ArchivePreviewDetails preview={archivePreview} /> : null}
            </li>
          );
        })}
      </ul>

      {downloadQueueState ? (
        <p className="state">
          {downloadQueueState.progress.completedFiles} of {downloadQueueState.progress.totalFiles} completed;{' '}
          {downloadQueueState.progress.skippedFiles} skipped; {downloadQueueState.progress.blockedFiles} blocked;{' '}
          {downloadQueueState.progress.failedFiles} failed.
        </p>
      ) : null}

      {downloadResult ? (
        <p className="state">
          Result: {downloadResult.status} ({downloadResult.completedFiles} completed, {downloadResult.skippedFiles} skipped,{' '}
          {downloadResult.failedFiles} failed, {downloadResult.cancelledFiles} cancelled)
        </p>
      ) : null}

      {summary.warnings.length > 0 ? (
        <ul className="warning-list">
          {summary.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {summary.errors.length > 0 ? (
        <ul className="warning-list error-list">
          {summary.errors.map((downloadError) => (
            <li key={`${downloadError.code}-${downloadError.message}`}>
              {downloadError.code}: {downloadError.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ArchivePreviewDetails({ preview }: { preview: ArchivePreview }): JSX.Element {
  const blockingWarnings = preview.warnings.filter((warning) => warning.blocking);

  return (
    <div className="archive-preview" aria-label="Archive extraction preview">
      <dl className="details compact">
        <div>
          <dt>Entries</dt>
          <dd>{preview.entryCount}</dd>
        </div>
        <div>
          <dt>Safe to extract</dt>
          <dd>{preview.safeToExtract ? 'yes' : 'no'}</dd>
        </div>
      </dl>
      <ul className="archive-entry-list">
        {preview.entries.map((entry, index) => (
          <li className={entry.blocked ? 'blocked-archive-entry' : undefined} key={`${entry.originalPath}-${index}`}>
            <span>{entry.targetRelativePath ?? entry.originalPath}</span>
            <small>
              {entry.type}
              {typeof entry.sizeBytes === 'number' ? ` / ${formatBytes(entry.sizeBytes)}` : ' / size unknown'}
              {entry.extension ? ` / ${entry.extension}` : ''}
            </small>
          </li>
        ))}
      </ul>
      {blockingWarnings.length > 0 ? (
        <ul className="warning-list error-list">
          {blockingWarnings.map((warning) => (
            <li key={`${warning.code}-${warning.entryPath ?? warning.message}`}>
              {warning.code}: {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.warnings.some((warning) => !warning.blocking) ? (
        <ul className="warning-list">
          {preview.warnings
            .filter((warning) => !warning.blocking)
            .map((warning) => (
              <li key={`${warning.code}-${warning.entryPath ?? warning.message}`}>
                {warning.code}: {warning.message}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReviewGroupList({
  reviewSession,
  onChange
}: {
  reviewSession: ReviewSession;
  onChange: (session: ReviewSession) => void;
}): JSX.Element {
  if (reviewSession.groups.length === 0) {
    return <p className="empty">No review groups are available yet.</p>;
  }

  return (
    <div className="group-list">
      <div className="review-actions candidate-actions" aria-label="Review file selection actions">
        <button type="button" className="secondary" onClick={() => onChange(includeRecommendedDownloadCandidates(reviewSession))}>
          Include recommended source/stem/archive files
        </button>
        <button type="button" className="secondary" onClick={() => onChange(excludePreviewDownloadCandidates(reviewSession))}>
          Exclude previews
        </button>
        <button type="button" className="secondary" onClick={() => onChange(excludeArchiveDownloadCandidates(reviewSession))}>
          Exclude archives
        </button>
        <button type="button" className="secondary" onClick={() => onChange(clearIncludedDownloadCandidates(reviewSession))}>
          Clear all included files
        </button>
      </div>
      {reviewSession.groups.map((group) => {
        const availableMergeTargets = reviewSession.groups.filter((candidate) => candidate.reviewGroupId !== group.reviewGroupId);

        return (
          <section className="group-summary" key={group.reviewGroupId}>
            <div className="group-heading">
              <div>
                <h3>{group.songFolderName}</h3>
                <span>{group.artistName}</span>
              </div>
              <span className={`source-badge status-${group.status}`}>{group.status}</span>
            </div>

            <div className="review-actions">
              <button type="button" className="secondary" onClick={() => onChange(markGroupAccepted(reviewSession, group.reviewGroupId))}>
                Accept
              </button>
              <button type="button" className="secondary" onClick={() => onChange(markGroupNeedsReview(reviewSession, group.reviewGroupId))}>
                Needs review
              </button>
              <button type="button" className="secondary" onClick={() => onChange(resetGroupOverrides(reviewSession, group.reviewGroupId))}>
                Reset
              </button>
              {availableMergeTargets.length > 0 ? (
                <select
                  aria-label={`Merge ${group.songFolderName}`}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) {
                      onChange(mergeGroups(reviewSession, group.reviewGroupId, event.target.value));
                      event.target.value = '';
                    }
                  }}
                >
                  <option value="">Merge into...</option>
                  {availableMergeTargets.map((targetGroup) => (
                    <option key={targetGroup.reviewGroupId} value={targetGroup.reviewGroupId}>
                      {targetGroup.songFolderName}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div className="edit-grid">
              <label className="field">
                <span>Artist folder</span>
                <input
                  value={group.artistName}
                  onChange={(event) => onChange(renameArtist(reviewSession, group.reviewGroupId, event.target.value))}
                />
              </label>
              <label className="field">
                <span>Song folder</span>
                <input
                  value={group.songFolderName}
                  onChange={(event) => onChange(renameGroup(reviewSession, group.reviewGroupId, event.target.value))}
                />
              </label>
            </div>

            {group.artistName !== group.originalGroup.artist || group.songFolderName !== group.originalGroup.canonicalSongTitle ? (
              <p className="original-note">
                Resolver: {group.originalGroup.artist} / {group.originalGroup.canonicalSongTitle}
              </p>
            ) : null}

            <ReviewMetadata group={group} />

            <ul className="candidate-list">
              {group.files.map((file) => (
                <li className={file.included ? undefined : 'excluded-file'} key={file.fileId}>
                  <label className="file-toggle">
                    <input
                      checked={file.included}
                      onChange={() => onChange(toggleFileIncluded(reviewSession, file.fileId))}
                      type="checkbox"
                    />
                    <span>{file.included ? 'Included' : 'Excluded'}</span>
                  </label>
                  <label className="field file-name-field">
                    <span>Target file name</span>
                    <input
                      value={file.targetFilename}
                      onChange={(event) => onChange(renameFile(reviewSession, file.fileId, event.target.value))}
                    />
                  </label>
                  {file.targetFilename !== file.originalFilename ? <small>Original: {file.originalFilename}</small> : null}
                  <CandidateBadges file={file.originalFile} />
                  {group.files.length > 1 ? (
                    <button
                      type="button"
                      className="secondary compact-button"
                      onClick={() => onChange(splitGroup(reviewSession, group.reviewGroupId, [file.fileId]))}
                    >
                      Split to new group
                    </button>
                  ) : null}
                  {file.overrideWarnings.length > 0 ? (
                    <ul className="warning-list">
                      {file.overrideWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {file.warnings.length > 0 ? (
                    <ul className="warning-list">
                      {file.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>

            {group.overrideWarnings.length > 0 ? (
              <ul className="warning-list">
                {group.overrideWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {group.warnings.length > 0 ? (
              <ul className="warning-list">
                {group.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ReviewMetadata({ group }: { group: ReviewGroup }): JSX.Element {
  const firstUpload = group.originalGroup.uploads[0];

  return (
    <>
      <dl className="details compact">
        <div>
          <dt>Confidence</dt>
          <dd>{group.originalGroup.confidence}</dd>
        </div>
        <div>
          <dt>BPM</dt>
          <dd>{group.originalGroup.bpm ?? 'not specified'}</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{firstUpload?.licenseSummary ?? 'not specified'}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{group.originalGroup.metadataSource}</dd>
        </div>
      </dl>
      {group.originalGroup.groupingReasons.length > 0 ? (
        <div className="reason-block">
          <span className="field-label">Grouping reasons</span>
          <ul className="reason-list">
            {group.originalGroup.groupingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {group.originalGroup.ambiguousUploads.length > 0 ? (
        <div className="reason-block">
          <span className="field-label">Ambiguous uploads</span>
          <ul className="reason-list">
            {group.originalGroup.ambiguousUploads.map((upload) => (
              <li key={upload.uploadId}>
                {upload.title} ({upload.uploadId})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function GroupList({ groups }: { groups: StemGroup[] }): JSX.Element {
  if (groups.length === 0) {
    return <p className="empty">No resolver groups are available yet.</p>;
  }

  return (
    <div className="group-list">
      {groups.map((group) => {
        const firstUpload = group.uploads[0];

        return (
          <section className="group-summary" key={group.groupId}>
            <div className="group-heading">
              <div>
                <h3>{group.canonicalSongTitle}</h3>
                <span>{group.artist}</span>
              </div>
              <span className="source-badge">{group.metadataSource}</span>
            </div>
            <dl className="details compact">
              <div>
                <dt>Confidence</dt>
                <dd>{group.confidence}</dd>
              </div>
              <div>
                <dt>BPM</dt>
                <dd>{group.bpm ?? 'not specified'}</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>{firstUpload?.licenseSummary ?? 'not specified'}</dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{firstUpload && firstUpload.tags.length > 0 ? firstUpload.tags.join(', ') : 'not specified'}</dd>
              </div>
            </dl>
            {group.uploads.some((upload) => upload.title !== group.canonicalSongTitle) ? (
              <div className="title-map">
                <span className="field-label">Original upload titles</span>
                <ul>
                  {group.uploads.map((upload) => (
                    <li key={upload.uploadId}>
                      <span>{upload.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {group.groupingReasons.length > 0 ? (
              <div className="reason-block">
                <span className="field-label">Grouping reasons</span>
                <ul className="reason-list">
                  {group.groupingReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ul className="candidate-list">
              {group.files.map((file) => (
                <li key={`${file.originalFilename}-${file.downloadUrl ?? file.metadataSource}`}>
                  <span>{file.originalFilename}</span>
                  <CandidateBadges file={file} />
                </li>
              ))}
            </ul>
            {group.unverifiedFields.length > 0 ? (
              <p className="unverified">Unverified: {group.unverifiedFields.join(', ')}</p>
            ) : null}
            {group.ambiguousUploads.length > 0 ? (
              <div className="reason-block">
                <span className="field-label">Ambiguous uploads</span>
                <ul className="reason-list">
                  {group.ambiguousUploads.map((upload) => (
                    <li key={upload.uploadId}>
                      {upload.title} ({upload.uploadId})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {group.warnings.length > 0 ? (
              <ul className="warning-list">
                {group.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function CandidateBadges({ file }: { file: ReviewFile['originalFile'] }): JSX.Element {
  const classification = getDownloadCandidateClassification(file);
  const label = `${classification.role} / ${classification.format} / ${classification.quality}`;
  const title = classification.reasons.join(' ');

  return (
    <div className="candidate-badges" title={title}>
      <span className="candidate-badge">{label}</span>
      <span className="candidate-badge confidence-badge">{classification.confidence}</span>
      <span className="candidate-badge source-badge">{file.metadataSource}</span>
    </div>
  );
}

function toAppError(error: unknown): AppError {
  return {
    code: 'RENDERER_ERROR',
    message: error instanceof Error ? error.message : 'An unexpected renderer error occurred.',
    recoverable: true
  };
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function toInitialDownloadQueueState(job: DownloadJob): DownloadQueueState {
  const activeFiles = job.files.filter((file) => file.status !== 'skipped');
  const blockedFiles = job.files.filter((file) => file.status === 'blocked');
  const writableFiles = job.files.filter((file) => file.status !== 'skipped' && file.status !== 'blocked');

  return {
    jobId: job.jobId,
    status: 'running',
    files: job.files.map((file) => ({
      fileJobId: file.fileJobId,
      targetRelativePath: file.targetRelativePath,
      status: file.status,
      receivedBytes: file.receivedBytes,
      totalBytes: file.totalBytes,
      warnings: file.warnings,
      errors: file.errors
    })),
    progress: {
      jobId: job.jobId,
      status: 'running',
      completedFiles: 0,
      totalFiles: writableFiles.length,
      skippedFiles: job.files.length - activeFiles.length,
      blockedFiles: blockedFiles.length,
      failedFiles: 0,
      warnings: job.warnings,
      errors: job.errors
    },
    warnings: job.warnings,
    errors: job.errors
  };
}
