import { t } from '../i18n';

export function PackageRemixPlaceholder(): JSX.Element {
  return (
    <section className="panel package-remix-placeholder" aria-label={t('packageRemix.title')}>
      <h2>{t('packageRemix.title')}</h2>
      <p>{t('packageRemix.description')}</p>
      <p className="empty">{t('packageRemix.comingSoon')}</p>
    </section>
  );
}
