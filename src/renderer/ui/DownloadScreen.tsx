import { summarizeDownloadJob } from '../../shared/domain';
import type { DownloadFileState, DownloadJob, DownloadQueueState, DownloadResult, DownloadStatus } from '../../shared/domain';
import { t } from '../i18n';

export function DownloadScreen({
  job,
  queueState,
  result,
  songCount,
  onCancel,
  onBackToReview
}: {
  job: DownloadJob;
  queueState: DownloadQueueState | null;
  result: DownloadResult | null;
  songCount: number;
  onCancel: (jobId: string) => void;
  onBackToReview: () => void;
}): JSX.Element {
  const summary = summarizeDownloadJob(job);
  const isRunning = queueState ? queueState.status === 'running' : true;
  const completedFiles = queueState?.progress.completedFiles ?? 0;
  const totalFiles = queueState?.progress.totalFiles ?? summary.writableFiles;

  return (
    <section className="download-screen" aria-label="Download">
      <header className="download-screen__heading">
        <h2>{t('download.title')}</h2>
        <span>
          {summary.writableFiles} {t('download.selectedFiles')} - {songCount} {t('download.songs')}
        </span>
      </header>

      <p className="download-screen__progress">
        {completedFiles} of {totalFiles} completed
      </p>

      <ul className="download-file-list">
        {job.files.map((file) => {
          const stateFile: DownloadFileState = queueState?.files.find((candidate) => candidate.fileJobId === file.fileJobId) ?? file;
          const firstError = stateFile.errors[0];

          return (
            <li key={file.fileJobId}>
              <span>{file.targetRelativePath}</span>
              <small>
                {stateFile.status}
                {typeof stateFile.receivedBytes === 'number' ? ` / ${formatBytes(stateFile.receivedBytes)}` : ''}
                {typeof stateFile.totalBytes === 'number' ? ` of ${formatBytes(stateFile.totalBytes)}` : ''}
              </small>
              {stateFile.status === 'failed' && firstError ? <p className="download-file-error">{firstError.message}</p> : null}
            </li>
          );
        })}
      </ul>

      {result ? (
        <p className="download-screen__result">
          <strong>{resultTitle(result.status)}</strong>
          <span>
            {result.completedFiles} completed, {result.failedFiles} failed
          </span>
        </p>
      ) : null}

      <div className="download-screen__actions">
        {isRunning ? (
          <button type="button" className="secondary" onClick={() => onCancel(job.jobId)}>
            {t('download.cancel')}
          </button>
        ) : (
          <button type="button" className="secondary" onClick={onBackToReview}>
            {t('download.backToReview')}
          </button>
        )}
      </div>
    </section>
  );
}

function resultTitle(status: DownloadStatus): string {
  if (status === 'cancelled') {
    return t('download.cancelled');
  }

  if (status === 'failed') {
    return t('download.failed');
  }

  return t('download.completed');
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
