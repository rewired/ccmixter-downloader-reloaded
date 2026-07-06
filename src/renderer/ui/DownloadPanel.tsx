import { summarizeDownloadJob } from '../../shared/domain';
import type { ArchivePreview, DownloadJob, DownloadQueueState, DownloadResult } from '../../shared/domain';
import { t } from '../i18n';

type Status = 'idle' | 'loading' | 'error';

export function DownloadPanel({
  advisoryJob,
  advisorySummary,
  advisoryValidationOk,
  canPrepareDownload,
  hasDownloadFolder,
  songCount,
  downloadJob,
  downloadQueueState,
  downloadResult,
  archivePreviews,
  archivePreviewErrors,
  onCancel,
  onChooseDownloadFolder,
  onConfirm,
  onPrepare,
  onPreviewArchive,
  status
}: {
  advisoryJob: DownloadJob;
  advisorySummary: ReturnType<typeof summarizeDownloadJob>;
  advisoryValidationOk: boolean;
  canPrepareDownload: boolean;
  hasDownloadFolder: boolean;
  songCount: number;
  downloadJob: DownloadJob | null;
  downloadQueueState: DownloadQueueState | null;
  downloadResult: DownloadResult | null;
  archivePreviews: Record<string, ArchivePreview>;
  archivePreviewErrors: Record<string, string>;
  onCancel: (jobId: string) => void;
  onChooseDownloadFolder: () => void;
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
  const primaryLabel = !hasDownloadFolder
    ? t('download.chooseFolder')
    : downloadJob
      ? t('download.start')
      : t('download.prepare');
  const primaryAction = !hasDownloadFolder
    ? onChooseDownloadFolder
    : downloadJob
      ? () => onConfirm(downloadJob.jobId)
      : onPrepare;
  const primaryDisabled = hasDownloadFolder && (downloadJob ? !canConfirm : !canPrepareDownload);

  return (
    <section className="download-panel" aria-label="Download">
      <div className="download-heading">
        <div>
          <h3>{t('download.title')}</h3>
          <span>
            {summary.writableFiles} {t('download.selectedFiles')} - {songCount} {t('download.songs')}
          </span>
        </div>
      </div>

      <div className="download-summary">
        <span>{t('download.folderInStatus')}</span>
        <span>{t('download.noWriteUntilStart')}</span>
      </div>

      <div className="download-actions">
        <button type="button" onClick={primaryAction} disabled={primaryDisabled}>
          {primaryLabel}
        </button>
        <button type="button" className="secondary" onClick={() => onCancel(downloadQueueState!.jobId)} disabled={!isRunning}>
          {t('download.cancel')}
        </button>
      </div>

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
          {downloadQueueState.progress.completedFiles} of {downloadQueueState.progress.totalFiles} completed.
        </p>
      ) : null}

      {downloadResult ? (
        <p className="state">
          Result: {downloadResult.status} ({downloadResult.completedFiles} completed, {downloadResult.failedFiles} failed)
        </p>
      ) : null}

      {!advisoryValidationOk || summary.errors.length > 0 ? (
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

export function ArchivePreviewDetails({ preview }: { preview: ArchivePreview }): JSX.Element {
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
    </div>
  );
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
