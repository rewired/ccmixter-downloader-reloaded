import { useEffect, useState } from 'react';

import type { AppError, CcmixterInput, DryRunPlan, StemLibraryRoot } from '../../shared/domain';
import type { AppInfo } from '../../shared/ipc';

type Status = 'idle' | 'loading' | 'error';

const PLACEHOLDER_WARNING = 'Dry run only - no files will be downloaded yet.';

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [rawInput, setRawInput] = useState('https://ccmixter.org/files/sample_artist/000000');
  const [stemLibraryRoot, setStemLibraryRoot] = useState<StemLibraryRoot | null>(null);
  const [parsedInput, setParsedInput] = useState<CcmixterInput | null>(null);
  const [dryRunPlan, setDryRunPlan] = useState<DryRunPlan | null>(null);
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

  async function chooseStemLibraryRoot(): Promise<void> {
    setStatus('loading');
    setError(null);

    try {
      const result = await window.ccmixterDownloader.chooseStemLibraryRoot();
      if (!result.cancelled) {
        setStemLibraryRoot(result.root);
        setDryRunPlan(null);
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
      setStatus('idle');
    } catch (parseError) {
      setError(toAppError(parseError));
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
      setDryRunPlan(planResult.value);
      setStatus('idle');
    } catch (planError) {
      setError(toAppError(planError));
      setStatus('error');
    }
  }

  const canCreateDryRun = stemLibraryRoot !== null && rawInput.trim().length > 0 && status !== 'loading';

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
          <strong>{PLACEHOLDER_WARNING}</strong>
          <span>No ccMixter scan, download, ZIP extraction, or attribution writing happens in this slice.</span>
        </section>

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
            <button type="button" onClick={() => void createDryRunPlan()} disabled={!canCreateDryRun}>
              Create dry run
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
                  <dd>{parsedInput.normalizedArtistLogin ?? 'not specified'}</dd>
                </div>
                <div>
                  <dt>Upload ID</dt>
                  <dd>{parsedInput.uploadId ?? 'not specified'}</dd>
                </div>
              </dl>
            ) : (
              <p className="empty">Enter a ccMixter input and parse it to see the local interpretation.</p>
            )}
          </article>

          <article className="panel preview-panel">
            <h2>Planned paths below root folder</h2>
            {dryRunPlan ? (
              <>
                <p className="root-path">{dryRunPlan.stemLibraryRoot.path}</p>
                <ul className="path-list">
                  {dryRunPlan.plannedFiles.map((file) => (
                    <li key={file.targetRelativePath}>
                      <span>{file.targetRelativePath}</span>
                    </li>
                  ))}
                </ul>
                <ul className="warning-list">
                  {dryRunPlan.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
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

function toAppError(error: unknown): AppError {
  return {
    code: 'RENDERER_ERROR',
    message: error instanceof Error ? error.message : 'An unexpected renderer error occurred.',
    recoverable: true
  };
}
