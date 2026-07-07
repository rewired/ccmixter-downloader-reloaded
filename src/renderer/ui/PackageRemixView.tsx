import { useState } from 'react';

import type {
  AppError,
  StemPackFolderRequest,
  StemPackInputFile,
  StemPackOptions,
  StemPackPreviewResult,
  StemPackResult
} from '../../shared/domain';
import { STEM_PACK_PREVIEW_OVERSIZED_WAV_THRESHOLD_MB } from '../../shared/domain';
import { t } from '../i18n';

interface MetadataFormState {
  title: string;
  artist: string;
  bpm: string;
  license: string;
  attribution: string;
}

const INITIAL_METADATA: MetadataFormState = {
  title: '',
  artist: '',
  bpm: '',
  license: '',
  attribution: ''
};

const INITIAL_OPTIONS: StemPackOptions = {
  maxArchiveSizeMb: STEM_PACK_PREVIEW_OVERSIZED_WAV_THRESHOLD_MB,
  splitOversizedStereoWav: false,
  includeStamp: true,
  overwrite: false
};

export function PackageRemixView(): JSX.Element {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<StemPackPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<AppError | null>(null);

  const [metadata, setMetadata] = useState<MetadataFormState>(INITIAL_METADATA);
  const [maxArchiveSizeMbInput, setMaxArchiveSizeMbInput] = useState(String(INITIAL_OPTIONS.maxArchiveSizeMb));
  const [splitOversizedStereoWav, setSplitOversizedStereoWav] = useState(INITIAL_OPTIONS.splitOversizedStereoWav);
  const [includeStamp, setIncludeStamp] = useState(INITIAL_OPTIONS.includeStamp);
  const [overwrite, setOverwrite] = useState(INITIAL_OPTIONS.overwrite);

  const [packLoading, setPackLoading] = useState(false);
  const [packError, setPackError] = useState<AppError | null>(null);
  const [packResult, setPackResult] = useState<StemPackResult | null>(null);

  async function chooseFolder(): Promise<void> {
    setPreviewError(null);

    try {
      const result = await window.ccmixterDownloader.chooseStemPackFolder();
      if (result.cancelled || !result.folderPath) {
        return;
      }

      setFolderPath(result.folderPath);
      setPreview(null);
      setPackResult(null);
      setPackError(null);
      await loadPreview(result.folderPath);
    } catch (error) {
      setPreviewError(toAppError(error));
    }
  }

  async function loadPreview(pathToPreview: string): Promise<void> {
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const result = await window.ccmixterDownloader.previewStemPackFolder(pathToPreview);
      if (!result.ok) {
        setPreview(null);
        setPreviewError(result.error);
        return;
      }

      setPreview(result.value);
    } catch (error) {
      setPreview(null);
      setPreviewError(toAppError(error));
    } finally {
      setPreviewLoading(false);
    }
  }

  const maxArchiveSizeMb = Number(maxArchiveSizeMbInput);
  const hasValidMaxSize = Number.isFinite(maxArchiveSizeMb) && maxArchiveSizeMb > 0;
  const hasPackableFiles = (preview?.packableFileCount ?? 0) > 0;
  const isMetadataValid =
    metadata.title.trim().length > 0 && metadata.artist.trim().length > 0 && metadata.license.trim().length > 0;
  const canCreatePackage =
    Boolean(folderPath) && !previewLoading && !packLoading && hasPackableFiles && isMetadataValid && hasValidMaxSize;

  async function createPackage(): Promise<void> {
    if (!folderPath || !canCreatePackage) {
      return;
    }

    setPackLoading(true);
    setPackError(null);
    setPackResult(null);

    const request: StemPackFolderRequest = {
      folderPath,
      metadata: {
        title: metadata.title.trim(),
        artist: metadata.artist.trim(),
        bpm: metadata.bpm.trim() || undefined,
        license: metadata.license.trim(),
        attribution: metadata.attribution.trim() || undefined
      },
      options: {
        maxArchiveSizeMb,
        splitOversizedStereoWav,
        includeStamp,
        overwrite
      }
    };

    try {
      const result = await window.ccmixterDownloader.packStemFolder(request);
      if (!result.ok) {
        setPackError(result.error);
        return;
      }

      setPackResult(result.value);
    } catch (error) {
      setPackError(toAppError(error));
    } finally {
      setPackLoading(false);
    }
  }

  return (
    <section className="panel package-remix" aria-label={t('packageRemix.title')}>
      <header>
        <h2>{t('packageRemix.title')}</h2>
        <p>{t('packageRemix.description')}</p>
        <p className="package-remix__clarify">{t('packageRemix.clarify')}</p>
      </header>

      <div className="package-remix__grid">
        <div className="package-remix__panel">
          <span className="field-label">{t('packageRemix.folderLabel')}</span>
          <p className="package-remix__folder-path">{folderPath ?? t('packageRemix.folderNone')}</p>
          <button type="button" onClick={() => void chooseFolder()} disabled={previewLoading || packLoading}>
            {t('packageRemix.chooseFolder')}
          </button>

          {previewLoading ? (
            <p className="package-remix__status" role="status">
              {t('packageRemix.previewLoading')}
            </p>
          ) : null}

          {previewError ? (
            <section className="error" role="alert">
              <strong>{previewError.message}</strong>
            </section>
          ) : null}

          {!folderPath && !previewLoading && !previewError ? <p className="empty">{t('packageRemix.noFolder')}</p> : null}

          {preview ? <PreviewSummary preview={preview} /> : null}
        </div>

        <div className="package-remix__panel">
          <form
            className="package-remix__form"
            onSubmit={(event) => {
              event.preventDefault();
              void createPackage();
            }}
          >
            <label className="field">
              <span>{t('packageRemix.metadataTitle')}</span>
              <input
                value={metadata.title}
                onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>{t('packageRemix.metadataArtist')}</span>
              <input
                value={metadata.artist}
                onChange={(event) => setMetadata((current) => ({ ...current, artist: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>{t('packageRemix.metadataBpm')}</span>
              <input value={metadata.bpm} onChange={(event) => setMetadata((current) => ({ ...current, bpm: event.target.value }))} />
            </label>
            <label className="field">
              <span>{t('packageRemix.metadataLicense')}</span>
              <input
                value={metadata.license}
                onChange={(event) => setMetadata((current) => ({ ...current, license: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>{t('packageRemix.metadataAttribution')}</span>
              <input
                value={metadata.attribution}
                onChange={(event) => setMetadata((current) => ({ ...current, attribution: event.target.value }))}
              />
            </label>

            <fieldset className="package-remix__options">
              <legend className="field-label">{t('packageRemix.optionsTitle')}</legend>
              <label className="field">
                <span>{t('packageRemix.optionsMaxSize')}</span>
                <input
                  type="number"
                  min="1"
                  value={maxArchiveSizeMbInput}
                  onChange={(event) => setMaxArchiveSizeMbInput(event.target.value)}
                  required
                />
              </label>
              <label className="file-toggle">
                <input
                  type="checkbox"
                  checked={splitOversizedStereoWav}
                  onChange={(event) => setSplitOversizedStereoWav(event.target.checked)}
                />
                <span>{t('packageRemix.optionsSplit')}</span>
              </label>
              <label className="file-toggle">
                <input type="checkbox" checked={includeStamp} onChange={(event) => setIncludeStamp(event.target.checked)} />
                <span>{t('packageRemix.optionsIncludeStamp')}</span>
              </label>
              <label className="file-toggle">
                <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                <span>{t('packageRemix.optionsOverwrite')}</span>
              </label>
            </fieldset>

            <button type="submit" disabled={!canCreatePackage}>
              {t('packageRemix.createButton')}
            </button>
          </form>

          {packLoading ? (
            <p className="package-remix__status" role="status">
              {t('packageRemix.creating')}
            </p>
          ) : null}

          {packError ? (
            <section className="error" role="alert">
              <strong>{packError.message}</strong>
            </section>
          ) : null}

          {packResult ? <PackResultSummary result={packResult} /> : null}
        </div>
      </div>
    </section>
  );
}

function PreviewSummary({ preview }: { preview: StemPackPreviewResult }): JSX.Element {
  if (preview.packableFileCount === 0) {
    return <p className="empty">{t('packageRemix.emptyPreview')}</p>;
  }

  return (
    <div className="package-remix__preview">
      <dl className="details compact">
        <div>
          <dt>{t('packageRemix.packableFiles')}</dt>
          <dd>
            {preview.packableFileCount} ({formatBytes(preview.totalPackableBytes)})
          </dd>
        </div>
        <div>
          <dt>{t('packageRemix.skippedFiles')}</dt>
          <dd>{preview.skippedFiles.length}</dd>
        </div>
        <div>
          <dt>{t('packageRemix.warnings')}</dt>
          <dd>{preview.warnings.length}</dd>
        </div>
      </dl>

      {preview.hasOversizedStereoWavCandidates ? (
        <p className="status-strip">
          <strong>{t('packageRemix.oversizedCandidates')}</strong>
        </p>
      ) : null}

      <ul className="package-remix__file-list">
        {preview.packableFiles.map((file: StemPackInputFile) => (
          <li key={file.path}>
            <span>{file.path}</span>
            <small>{formatBytes(file.sizeBytes)}</small>
          </li>
        ))}
      </ul>

      {preview.skippedFiles.length > 0 ? (
        preview.skippedFiles.length > 5 ? (
          <details className="package-remix__file-list">
            <summary>
              {t('packageRemix.skippedFiles')} ({preview.skippedFiles.length})
            </summary>
            <ul>
              {preview.skippedFiles.map((skippedPath) => (
                <li key={skippedPath}>{skippedPath}</li>
              ))}
            </ul>
          </details>
        ) : (
          <ul className="package-remix__file-list">
            {preview.skippedFiles.map((skippedPath) => (
              <li key={skippedPath}>{skippedPath}</li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function PackResultSummary({ result }: { result: StemPackResult }): JSX.Element {
  return (
    <div className="package-remix__result">
      <h3>{t('packageRemix.resultTitle')}</h3>
      <p className="state">{t('packageRemix.resultSuccess')}</p>

      <div>
        <span className="field-label">{t('packageRemix.resultArchives')}</span>
        <ul className="path-list">
          {result.archives.map((archivePath) => (
            <li key={archivePath}>{archivePath}</li>
          ))}
        </ul>
      </div>

      {result.warnings.length > 0 ? (
        <div>
          <span className="field-label">{t('packageRemix.resultWarnings')}</span>
          <ul className="warning-list warning-list--global">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.skippedFiles.length > 0 ? (
        <div>
          <span className="field-label">{t('packageRemix.resultSkipped')}</span>
          <ul className="path-list">
            {result.skippedFiles.map((skippedPath) => (
              <li key={skippedPath}>{skippedPath}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="user-note">
        {result.tempArtifactsRemoved ? t('packageRemix.resultTempCleanedUp') : t('packageRemix.resultTempCleanupFailed')}
      </p>
    </div>
  );
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

function toAppError(error: unknown): AppError {
  return {
    code: 'PACKAGE_REMIX_RENDERER_ERROR',
    message: error instanceof Error ? error.message : 'An unexpected error occurred while packaging the remix.',
    recoverable: true
  };
}
