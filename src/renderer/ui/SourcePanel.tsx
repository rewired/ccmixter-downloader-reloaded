type Status = 'idle' | 'loading' | 'error';

export function SourcePanel({
  rawInput,
  onRawInputChange,
  onScanSource,
  onParseInput,
  onResolveMetadata,
  canScan,
  status
}: {
  rawInput: string;
  onRawInputChange: (value: string) => void;
  onScanSource: () => void;
  onParseInput: () => void;
  onResolveMetadata: () => void;
  canScan: boolean;
  status: Status;
}): JSX.Element {
  return (
    <section className="source-panel">
      <div className="source-panel__row">
        <label className="field">
          <span>ccMixter source</span>
          <input
            value={rawInput}
            onChange={(event) => onRawInputChange(event.target.value)}
            placeholder="Paste a ccMixter artist link, upload link, or upload ID"
          />
        </label>
        <button type="button" onClick={onScanSource} disabled={!canScan}>
          Scan source
        </button>
      </div>

      <details className="source-panel__dev-actions">
        <summary>Developer actions</summary>
        <div className="source-panel__dev-buttons">
          <button type="button" className="secondary" onClick={onParseInput} disabled={status === 'loading'}>
            Parse input
          </button>
          <button type="button" className="secondary" onClick={onResolveMetadata} disabled={status === 'loading'}>
            Resolve metadata
          </button>
        </div>
      </details>
    </section>
  );
}
