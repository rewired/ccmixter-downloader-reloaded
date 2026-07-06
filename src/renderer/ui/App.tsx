import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ARTIST_SCAN_REALITY_CHECK_WARNING,
  buildReviewedDryRunPlan,
  createDownloadJobFromReviewedPlan,
  createDryRunPlanFromGroups,
  createReviewSessionFromDryRunPlan,
  isArtistCatalogInput,
  summarizeDownloadJob,
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
  type ReviewSession,
  type StemLibraryRoot
} from '../../shared/domain';
import type { AppInfo } from '../../shared/ipc';

import { resolveArtistCatalogCounts, selectWarningTiers } from './catalogStatus';
import { DownloadPanel } from './DownloadPanel';
import { SourcePanel } from './SourcePanel';
import { StatusBar } from './StatusBar';
import { TechnicalDetails } from './TechnicalDetails';
import { UploadListDetail, type ListMode } from './UploadListDetail';

export { resolveArtistCatalogStatus } from './catalogStatus';

type Status = 'idle' | 'loading' | 'error';

const DOWNLOAD_WARNING = 'Downloads start only after review and explicit confirmation.';

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [rawInput, setRawInput] = useState('');
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
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
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
              pagingIncomplete: page.pagingIncomplete,
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

  async function startArtistCatalog(explicitInput?: CcmixterInput): Promise<void> {
    setStatus('loading');
    setError(null);
    setCatalogSessionState(null);

    try {
      const input = explicitInput ?? parsedInput;

      if (!input?.artistLogin) {
        setError({ code: 'NO_ARTIST_LOGIN', message: 'Artist login could not be determined.', recoverable: true });
        setStatus('error');
        return;
      }

      if (!stemLibraryRoot) {
        setError({ code: 'STEM_LIBRARY_ROOT_REQUIRED', message: 'Choose a Stem Library Root Folder before reviewing uploads.', recoverable: true });
        setStatus('error');
        return;
      }

      const result = await window.ccmixterDownloader.artistCatalogStart(input.artistLogin, input.sourceUrl);

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

  async function scanSource(): Promise<void> {
    setStatus('loading');
    setError(null);

    try {
      const parsed = await window.ccmixterDownloader.parseInput(rawInput);
      setParsedInput(parsed);
      setResolvedMetadata(null);
      setReviewSession(null);
      resetDownloadState();

      if (isArtistCatalogInput(parsed)) {
        await startArtistCatalog(parsed);
      } else {
        await createDryRunPlan();
      }
    } catch (scanError) {
      setError(toAppError(scanError));
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

  const canScanSource = stemLibraryRoot !== null && rawInput.trim().length > 0 && status !== 'loading';
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

  const listMode = useMemo<ListMode | null>(() => {
    if (reviewSession) {
      return { kind: 'review', reviewSession, onChange: setReviewSession };
    }
    if (dryRunPlan) {
      return { kind: 'raw', groups: dryRunPlan.groups };
    }
    if (resolvedMetadata) {
      return { kind: 'raw', groups: resolvedMetadata.groups };
    }
    return null;
  }, [reviewSession, dryRunPlan, resolvedMetadata]);

  useEffect(() => {
    const activeIds = listMode
      ? listMode.kind === 'review'
        ? listMode.reviewSession.groups.map((group) => group.reviewGroupId)
        : listMode.groups.map((group) => group.groupId)
      : [];

    if (activeIds.length === 0) {
      if (selectedGroupId !== null) {
        setSelectedGroupId(null);
      }
      return;
    }

    if (selectedGroupId === null || !activeIds.includes(selectedGroupId)) {
      setSelectedGroupId(activeIds[0]!);
    }
  }, [listMode, selectedGroupId]);

  const selectedGroupForTiers = listMode
    ? listMode.kind === 'review'
      ? listMode.reviewSession.groups.find((group) => group.reviewGroupId === selectedGroupId) ?? null
      : listMode.groups.find((group) => group.groupId === selectedGroupId) ?? null
    : null;
  const globalWarnings = reviewedDryRunPlan?.warnings ?? resolvedMetadata?.warnings ?? [];
  const warningTiers = selectWarningTiers(globalWarnings, selectedGroupForTiers);

  return (
    <main className="app-shell">
      <div className="workspace">
        <header className="app-header">
          <div>
            <p className="eyebrow">Stem library planner</p>
            <h1>{appInfo?.name ?? 'ccMixter Stem Downloader'}</h1>
          </div>
          <span className="version">v{appInfo?.version ?? '0.1.0'}</span>
        </header>

        <section className="status-strip" role="status">
          <strong>{DOWNLOAD_WARNING}</strong>
          <span>No ZIP extraction or attribution writing happens in this slice.</span>
        </section>

        <SourcePanel
          rawInput={rawInput}
          onRawInputChange={setRawInput}
          onScanSource={() => void scanSource()}
          onParseInput={() => void parseInput()}
          onResolveMetadata={() => void resolveMetadata()}
          canScan={canScanSource}
          status={status}
        />

        {status === 'loading' ? <p className="state">Working...</p> : null}
        {error ? (
          <section className="error" role="alert">
            <strong>{error.message}</strong>
            <span>{error.recoverable ? 'You can adjust the input or root folder and try again.' : 'Restart may be required.'}</span>
          </section>
        ) : null}

        <TechnicalDetails
          parsedInput={parsedInput}
          dryRunPlan={dryRunPlan}
          resolvedMetadata={resolvedMetadata}
          catalogCounts={catalogCounts}
          catalogIsLoadingMore={catalogIsLoadingMore}
          hasMore={catalogSessionState?.hasMore ?? false}
          pagingIncomplete={catalogSessionState?.pagingIncomplete ?? false}
        />

        {isArtistCatalog ? (
          <section className="banner artist-scan-banner" role="status">
            <strong>Review artist uploads</strong>
            <span>{ARTIST_SCAN_REALITY_CHECK_WARNING}</span>
          </section>
        ) : null}

        {warningTiers.global.length > 0 ? (
          <ul className="warning-list warning-list--global" aria-label="Global warnings">
            {warningTiers.global.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        <section className="results" aria-label="Upload review">
          {listMode ? (
            <UploadListDetail mode={listMode} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} />
          ) : (
            <p className="empty">
              {stemLibraryRoot
                ? 'Enter a ccMixter artist, upload link, or upload ID to scan available uploads. No downloads will start without confirmation.'
                : 'Stem library not set. You can scan sources now, but choose a folder before creating a download plan.'}
            </p>
          )}

          {isArtistCatalog ? <div ref={sentinelRef} id="catalog-scroll-sentinel" /> : null}

          {dryRunPlan ? (
            <>
              <p className="root-path">{dryRunPlan.stemLibraryRoot.path}</p>
              <ul className="path-list">
                {reviewedDryRunPlan?.plannedFiles.map((file, index) => (
                  <li key={`${file.targetRelativePath}-${index}`}>
                    <span>{file.targetRelativePath}</span>
                  </li>
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
          ) : null}
        </section>
      </div>

      <StatusBar
        stemLibraryRoot={stemLibraryRoot}
        onChooseRoot={() => void chooseStemLibraryRoot()}
        isArtistCatalog={isArtistCatalog}
        catalogCounts={catalogCounts}
        catalogIsLoadingMore={catalogIsLoadingMore}
        hasMore={catalogSessionState?.hasMore ?? false}
        pagingIncomplete={catalogSessionState?.pagingIncomplete ?? false}
        sourceMode={dryRunPlan?.metadataSource ?? resolvedMetadata?.metadataSource ?? null}
        plannedFileCount={reviewedDryRunPlan?.plannedFiles.length ?? 0}
        status={status}
      />
    </main>
  );
}

function toAppError(error: unknown): AppError {
  return {
    code: 'RENDERER_ERROR',
    message: error instanceof Error ? error.message : 'An unexpected renderer error occurred.',
    recoverable: true
  };
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
