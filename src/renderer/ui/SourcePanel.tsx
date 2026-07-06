import { t } from '../i18n';

type Status = 'idle' | 'loading' | 'error';

export function SourcePanel({
  rawInput,
  onRawInputChange,
  onScanSource,
  onCancelScan,
  canScan,
  canCancelScan,
  status
}: {
  rawInput: string;
  onRawInputChange: (value: string) => void;
  onScanSource: () => void;
  onCancelScan: () => void;
  canScan: boolean;
  canCancelScan: boolean;
  status: Status;
}): JSX.Element {
  return (
    <section className="source-panel">
      <h2>{t('source.title')}</h2>
      <div className="source-panel__row">
        <label className="field">
          <span>{t('source.inputLabel')}</span>
          <input
            value={rawInput}
            onChange={(event) => onRawInputChange(event.target.value)}
            placeholder={t('source.placeholder')}
          />
        </label>
        <div className="source-panel__actions">
          <button type="button" onClick={onScanSource} disabled={!canScan}>
            {t('scan.button')}
          </button>
          {canCancelScan ? (
            <button type="button" className="secondary" onClick={onCancelScan} disabled={status !== 'loading'}>
              {t('scan.cancel')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
