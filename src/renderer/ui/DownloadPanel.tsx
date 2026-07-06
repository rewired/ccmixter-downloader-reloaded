import { summarizeDownloadJob } from '../../shared/domain';
import type { ArchivePreview, DownloadJob, DownloadQueueState, DownloadResult } from '../../shared/domain';

type Status = 'idle' | 'loading' | 'error';

export function DownloadPanel({
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

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
