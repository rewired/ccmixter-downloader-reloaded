import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildReviewedDryRunPlan,
  clearIncludedDownloadCandidates,
  createDryRunPlanFromGroups,
  createReviewSessionFromDryRunPlan,
  isArtistCatalogInput,
  type AppError,
  type ArtistCatalogPageResult,
  type ArtistCatalogScanPhase,
  type ArtistCatalogState,
  type CcmixterInput,
  type DownloadJob,
  type DownloadQueueState,
  type DownloadResult,
  type DryRunPlan,
  type ResolvedCcmixterMetadata,
  type ReviewSession,
  type StemGroup,
  type StemLibraryRoot
} from '../../shared/domain';
import type { AppInfo } from '../../shared/ipc';
import { t } from '../i18n';

import { resolveArtistCatalogCounts } from './catalogStatus';
import { DownloadScreen } from './DownloadScreen';
import { PackageRemixPlaceholder } from './PackageRemixPlaceholder';
import { SourcePanel } from './SourcePanel';
import { StatusBar } from './StatusBar';
import { TechnicalDetails } from './TechnicalDetails';
import { UploadListDetail, type ListMode } from './UploadListDetail';

export { resolveArtistCatalogStatus } from './catalogStatus';

type Status = 'idle' | 'loading' | 'error';
type AppScreen = 'review' | 'download';
type ActiveTool = 'source' | 'package';

const PLACEHOLDER_ROOT: StemLibraryRoot = {
  path: '',
  selectedAt: 'not specified'
};

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [rawInput, setRawInput] = useState('');
  const [stemLibraryRoot, setStemLibraryRoot] = useState<StemLibraryRoot | null>(null);
  const [parsedInput, setParsedInput] = useState<CcmixterInput | null>(null);
  const [resolvedMetadata, setResolvedMetadata] = useState<ResolvedCcmixterMetadata | null>(null);
  const [dryRunPlan, setDryRunPlan] = useState<DryRunPlan | null>(null);
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [downloadJob, setDownloadJob] = useState<DownloadJob | null>(null);
  const [downloadSongCount, setDownloadSongCount] = useState(0);
  const [downloadQueueState, setDownloadQueueState] = useState<DownloadQueueState | null>(null);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const [screen, setScreen] = useState<AppScreen>('review');
  const [activeTool, setActiveTool] = useState<ActiveTool>('source');
  const [catalogSessionState, setCatalogSessionState] = useState<ArtistCatalogState | null>(null);
  const [catalogIsLoadingMore, setCatalogIsLoadingMore] = useState(false);
  const [artistScanRunning, setArtistScanRunning] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<AppError | null>(null);
  const cancelScanRequestedRef = useRef(false);

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

  async function startArtistCatalog(explicitInput: CcmixterInput): Promise<void> {
    setStatus('loading');
    setError(null);
    setCatalogSessionState(null);
    setArtistScanRunning(true);
    setCatalogIsLoadingMore(true);
    cancelScanRequestedRef.current = false;

    try {
      if (!explicitInput.artistLogin) {
        setError({ code: 'NO_ARTIST_LOGIN', message: 'Artist login could not be determined.', recoverable: true });
        setStatus('error');
        setArtistScanRunning(false);
        setCatalogIsLoadingMore(false);
        return;
      }

      const startResult = await window.ccmixterDownloader.artistCatalogStart(explicitInput.artistLogin, explicitInput.sourceUrl);

      if (!startResult.ok) {
        setError(startResult.error);
        setStatus('error');
        setArtistScanRunning(false);
        setCatalogIsLoadingMore(false);
        return;
      }

      let state: ArtistCatalogState | ArtistCatalogPageResult = startResult.value;
      applyCatalogResult(state, explicitInput);

      while (state.hasMore && !cancelScanRequestedRef.current) {
        setCatalogIsLoadingMore(true);
        const pageResult = await window.ccmixterDownloader.artistCatalogLoadMore(state.sessionId);

        if (!pageResult.ok) {
          setError(pageResult.error);
          setStatus('error');
          break;
        }

        state = pageResult.value;
        applyCatalogResult(state, explicitInput);
      }

      setCatalogIsLoadingMore(false);
      setArtistScanRunning(false);
      setStatus('idle');
    } catch (err) {
      setError(toAppError(err));
      setCatalogIsLoadingMore(false);
      setArtistScanRunning(false);
      setStatus('error');
    }
  }

  async function cancelArtistScan(): Promise<void> {
    const sessionId = catalogSessionState?.sessionId;
    cancelScanRequestedRef.current = true;
    setArtistScanRunning(false);

    if (!sessionId) {
      return;
    }

    try {
      const cancelResult = await window.ccmixterDownloader.artistCatalogCancel(sessionId);
      if (cancelResult.ok) {
        applyCatalogResult(cancelResult.value, parsedInput);
      } else {
        setError(cancelResult.error);
      }
    } catch (cancelError) {
      setError(toAppError(cancelError));
    } finally {
      setCatalogIsLoadingMore(false);
      setStatus('idle');
    }
  }

  function applyCatalogResult(result: ArtistCatalogState | ArtistCatalogPageResult, input: CcmixterInput | null): void {
    setCatalogSessionState((previous) => ({
      ...(previous ?? toCatalogStateShell(result, input)),
      ...result,
      totalCount: result.totalCount ?? previous?.totalCount,
      totalUploadCount: result.totalUploadCount ?? previous?.totalUploadCount,
      isLoadingMore: 'isLoadingMore' in result ? result.isLoadingMore : false
    }));

    const root = stemLibraryRoot ?? PLACEHOLDER_ROOT;
    const plan = createPlanFromCatalogResult(rawInput, root, result.groups, result);
    const newSession = createReviewSessionFromDryRunPlan(plan);

    setParsedInput(plan.input);
    setResolvedMetadata(null);
    setDryRunPlan(plan);
    setReviewSession((currentSession) => (currentSession ? mergeReviewSessions(currentSession, newSession) : newSession));
    resetDownloadState();
  }

  async function createDryRunPlan(): Promise<void> {
    setStatus('loading');
    setError(null);

    try {
      if (stemLibraryRoot) {
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
      } else {
        const metadataResult = await window.ccmixterDownloader.resolveMetadata(rawInput);

        if (!metadataResult.ok) {
          setError(metadataResult.error);
          setStatus('error');
          return;
        }

        const plan = createDryRunPlanFromGroups(rawInput, PLACEHOLDER_ROOT, metadataResult.value.groups, {
          createdAt: metadataResult.value.createdAt,
          input: metadataResult.value.input,
          metadataSource: metadataResult.value.metadataSource,
          placeholderData: metadataResult.value.metadataSource === 'fixture',
          resolverStatus: metadataResult.value.status,
          warnings: metadataResult.value.warnings
        });
        setParsedInput(plan.input);
        setResolvedMetadata(null);
        setDryRunPlan(plan);
        setReviewSession(createReviewSessionFromDryRunPlan(plan));
      }

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
      setCatalogSessionState(null);
      resetDownloadState();

      if (isArtistCatalogInput(parsed)) {
        await startArtistCatalog(parsed);
      } else {
        await createDryRunPlan();
      }
    } catch (scanError) {
      setError(toAppError(scanError));
      setStatus('error');
      setArtistScanRunning(false);
      setCatalogIsLoadingMore(false);
    }
  }

  async function onDownloadClick(): Promise<void> {
    if (!reviewedDryRunPlan) {
      setError({ code: 'DOWNLOAD_NO_FILES', message: t('download.errorNoFiles'), recoverable: true });
      return;
    }

    await startDownload(reviewedDryRunPlan);
  }

  async function startDownload(reviewedPlan: DryRunPlan): Promise<void> {
    if (reviewedPlan.plannedFiles.length === 0) {
      setError({ code: 'DOWNLOAD_NO_FILES', message: t('download.errorNoFiles'), recoverable: true });
      return;
    }

    if (!stemLibraryRoot) {
      setError({ code: 'DOWNLOAD_ROOT_REQUIRED', message: t('download.errorRootRequired'), recoverable: true });
      return;
    }

    setStatus('loading');
    setError(null);
    setDownloadResult(null);

    try {
      const jobResult = await window.ccmixterDownloader.createDownloadJob(reviewedPlan);

      if (!jobResult.ok) {
        setError(jobResult.error);
        setStatus('idle');
        return;
      }

      const startResult = await window.ccmixterDownloader.startDownloadJob(jobResult.value.jobId);

      if (!startResult.ok) {
        setError(startResult.error);
        setStatus('idle');
        return;
      }

      const attemptedAnyFile = startResult.value.files.some(
        (file) => file.status === 'running' || file.status === 'completed' || file.status === 'failed' || file.status === 'cancelled'
      );

      if (startResult.value.status === 'failed' && !attemptedAnyFile && startResult.value.errors.length > 0) {
        setError(startResult.value.errors[0]!);
        setStatus('idle');
        return;
      }

      setDownloadSongCount(songCount);
      setDownloadJob(jobResult.value);
      setDownloadQueueState(startResult.value);
      if (attemptedAnyFile && isTerminalDownloadStatus(startResult.value.status)) {
        setReviewSession((currentSession) => (currentSession ? clearIncludedDownloadCandidates(currentSession) : currentSession));
      }
      setStatus('idle');
      setScreen('download');
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

  function backToReview(): void {
    resetDownloadState();
  }

  function resetDownloadState(): void {
    setDownloadJob(null);
    setDownloadSongCount(0);
    setDownloadQueueState(null);
    setDownloadResult(null);
    setScreen('review');
  }

  const canScanSource = rawInput.trim().length > 0 && status !== 'loading';
  const activeInput = dryRunPlan?.input ?? resolvedMetadata?.input ?? parsedInput;
  const isArtistCatalog = activeInput ? isArtistCatalogInput(activeInput) : false;
  const scanPhase: ArtistCatalogScanPhase = catalogSessionState?.scanPhase ?? (artistScanRunning ? 'catalog' : 'idle');
  const reviewedDryRunPlan = useMemo(
    () => (dryRunPlan && reviewSession ? buildReviewedDryRunPlan(reviewSession, stemLibraryRoot ?? dryRunPlan.stemLibraryRoot) : dryRunPlan),
    [dryRunPlan, reviewSession, stemLibraryRoot]
  );
  const catalogCounts = isArtistCatalog ? resolveArtistCatalogCounts(catalogSessionState, resolvedMetadata, dryRunPlan, reviewedDryRunPlan) : null;
  const songCount = reviewSession?.groups.filter((group) => group.files.some((file) => file.included)).length ?? 0;
  const downloadFileCount = reviewedDryRunPlan?.plannedFiles.length ?? 0;
  const isDownloading = downloadQueueState?.status === 'running';
  const canDownload = downloadFileCount > 0 && status !== 'loading';

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
        ? listMode.reviewSession.groups.filter((group) => group.files.length > 0).map((group) => group.reviewGroupId)
        : listMode.groups.filter((group) => group.files.length > 0).map((group) => group.groupId)
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

  return (
    <main className={`app-shell${activeTool === 'package' ? ' app-shell--no-status-bar' : ''}`}>
      <div className="workspace">
        <header className="app-header">
          <div>
            <p className="eyebrow">{t('app.eyebrow')}</p>
            <h1>{appInfo?.name ?? 'ccMixter Stem Downloader'}</h1>
          </div>
          <span className="version">v{appInfo?.version ?? '0.2.0'}</span>
        </header>

        <div className="tool-switch" role="group" aria-label={t('app.toolSwitch.label')}>
          <button
            type="button"
            className={`tool-switch__button${activeTool === 'source' ? ' selected' : ''}`}
            aria-pressed={activeTool === 'source'}
            onClick={() => setActiveTool('source')}
          >
            {t('app.tool.source')}
          </button>
          <button
            type="button"
            className={`tool-switch__button${activeTool === 'package' ? ' selected' : ''}`}
            aria-pressed={activeTool === 'package'}
            onClick={() => setActiveTool('package')}
          >
            {t('app.tool.package')}
          </button>
        </div>

        {error ? (
          <section className="error" role="alert">
            <strong>{error.message}</strong>
            <span>{error.recoverable ? 'Adjust the input or download folder and try again.' : 'Restart may be required.'}</span>
          </section>
        ) : null}

        {activeTool === 'package' ? (
          <PackageRemixPlaceholder />
        ) : screen === 'download' && downloadJob ? (
          <DownloadScreen
            job={downloadJob}
            queueState={downloadQueueState}
            result={downloadResult}
            songCount={downloadSongCount}
            onCancel={(jobId) => void cancelDownloadJob(jobId)}
            onBackToReview={backToReview}
          />
        ) : (
          <>
            <SourcePanel
              rawInput={rawInput}
              onRawInputChange={setRawInput}
              onScanSource={() => void scanSource()}
              onCancelScan={() => void cancelArtistScan()}
              canScan={canScanSource}
              canCancelScan={artistScanRunning && Boolean(catalogSessionState)}
              status={status}
            />

            <ScanProgress phase={scanPhase} counts={catalogCounts} running={artistScanRunning || catalogIsLoadingMore} />

            <TechnicalDetails
              parsedInput={parsedInput}
              dryRunPlan={dryRunPlan}
              resolvedMetadata={resolvedMetadata}
              reviewSession={reviewSession}
              catalogCounts={catalogCounts}
              catalogIsLoadingMore={catalogIsLoadingMore}
              hasMore={catalogSessionState?.hasMore ?? false}
              pagingIncomplete={catalogSessionState?.pagingIncomplete ?? false}
              onParseInput={() => void parseInput()}
              onResolveMetadata={() => void resolveMetadata()}
              status={status}
            />

            <section className="results" aria-label="Song and file review">
              {listMode ? (
                <UploadListDetail
                  mode={listMode}
                  selectedGroupId={selectedGroupId}
                  onSelectGroup={setSelectedGroupId}
                  noFilesFoundUploads={catalogSessionState?.noFilesFoundUploads ?? []}
                  couldNotCheckFilesUploads={catalogSessionState?.couldNotCheckFilesUploads ?? []}
                />
              ) : (
                <p className="empty">{t('review.empty')}</p>
              )}
            </section>
          </>
        )}
      </div>

      {activeTool === 'source' ? (
        <StatusBar
          stemLibraryRoot={stemLibraryRoot}
          onChooseRoot={() => void chooseStemLibraryRoot()}
          isArtistCatalog={isArtistCatalog}
          catalogCounts={catalogCounts}
          scanPhase={scanPhase}
          plannedFileCount={reviewedDryRunPlan?.plannedFiles.length ?? 0}
          hasReviewSession={Boolean(reviewSession)}
          downloadFileCount={downloadFileCount}
          canDownload={canDownload}
          isDownloading={Boolean(isDownloading)}
          onDownload={() => void onDownloadClick()}
        />
      ) : null}
    </main>
  );
}

function ScanProgress({
  phase,
  counts,
  running
}: {
  phase: ArtistCatalogScanPhase;
  counts: ReturnType<typeof resolveArtistCatalogCounts>;
  running: boolean;
}): JSX.Element | null {
  if (!running && !counts) {
    return null;
  }

  const message = resolveScanMessage(phase, counts);

  return (
    <section className="scan-progress" role="status">
      <strong>{message}</strong>
      {counts ? (
        <span>
          Found {counts.downloadableGroupCount} song{counts.downloadableGroupCount === 1 ? '' : 's'} - {counts.downloadableFileCount} file{counts.downloadableFileCount === 1 ? '' : 's'}
        </span>
      ) : null}
    </section>
  );
}

function resolveScanMessage(phase: ArtistCatalogScanPhase, counts: ReturnType<typeof resolveArtistCatalogCounts>): string {
  if (phase === 'catalog') {
    return t('scan.catalog');
  }

  if (phase === 'pages' || phase === 'files') {
    const total = counts?.totalUploadCount ?? counts?.totalCount;
    return `${t('scan.pages')} ${counts?.checkedUploadCount ?? 0}${typeof total === 'number' ? ` of ${total}` : ''}`;
  }

  if (phase === 'planning') {
    return t('scan.planning');
  }

  if (phase === 'cancelled') {
    return t('scan.cancelled');
  }

  return t('scan.done');
}

function createPlanFromCatalogResult(
  rawInput: string,
  root: StemLibraryRoot,
  groups: StemGroup[],
  result: ArtistCatalogState | ArtistCatalogPageResult
): DryRunPlan {
  return createDryRunPlanFromGroups(rawInput, root, groups, {
    metadataSource: groups.some((group) => group.metadataSource === 'html-enriched') ? 'html-enriched' : 'api',
    placeholderData: false,
    resolverStatus: result.hasMore || result.scanPhase === 'cancelled' ? 'partial' : 'resolved',
    warnings: result.warnings
  });
}

function toCatalogStateShell(result: ArtistCatalogState | ArtistCatalogPageResult, input: CcmixterInput | null): ArtistCatalogState {
  return {
    sessionId: result.sessionId,
    artistLogin: input?.artistLogin ?? input?.normalizedArtistLogin ?? 'not specified',
    sourceUrl: input?.sourceUrl ?? '',
    loadedUploadIds: [],
    groups: [],
    loadedCount: 0,
    checkedUploadCount: 0,
    downloadableGroupCount: 0,
    downloadableFileCount: 0,
    noFilesFoundCount: 0,
    couldNotCheckFilesCount: 0,
    noFilesFoundUploads: [],
    couldNotCheckFilesUploads: [],
    scanPhase: 'idle',
    hasMore: false,
    isLoadingMore: false,
    pagingIncomplete: false,
    warnings: []
  };
}

function mergeReviewSessions(existingSession: ReviewSession, newSession: ReviewSession): ReviewSession {
  const existingByOriginalId = new Map(existingSession.groups.map((group) => [group.originalGroupId, group]));

  return {
    ...newSession,
    groups: newSession.groups.map((group) => existingByOriginalId.get(group.originalGroupId) ?? group),
    overrides: existingSession.overrides,
    warnings: [...newSession.warnings, ...existingSession.warnings].filter(unique)
  };
}

function toAppError(error: unknown): AppError {
  return {
    code: 'RENDERER_ERROR',
    message: error instanceof Error ? error.message : 'An unexpected renderer error occurred.',
    recoverable: true
  };
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}

function isTerminalDownloadStatus(status: DownloadQueueState['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
