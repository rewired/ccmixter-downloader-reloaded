export interface ParsedLicenseBadge {
  code: 'by' | 'by-nc';
  version: '3.0' | '4.0';
}

const RESTRICTIVE_TERM_PATTERN = /share.?alike|\bsa\b|noderiv|\bnd\b/i;
const VERSION_PATTERN = /\b([34])\.0\b/;
const ATTRIBUTION_PATTERN = /attribution|\bcc\s*by\b|\bby\b/i;
const NONCOMMERCIAL_PATTERN = /noncommercial|non-commercial|\bnc\b/i;

export function parseLicenseBadge(licenseSummary?: string): ParsedLicenseBadge | undefined {
  if (!licenseSummary || RESTRICTIVE_TERM_PATTERN.test(licenseSummary)) {
    return undefined;
  }

  const versionMatch = VERSION_PATTERN.exec(licenseSummary);

  if (!versionMatch || !ATTRIBUTION_PATTERN.test(licenseSummary)) {
    return undefined;
  }

  return {
    code: NONCOMMERCIAL_PATTERN.test(licenseSummary) ? 'by-nc' : 'by',
    version: versionMatch[1] === '4' ? '4.0' : '3.0'
  };
}

export function LicenseBadge({ licenseSummary }: { licenseSummary?: string }): JSX.Element {
  const badge = parseLicenseBadge(licenseSummary);

  if (!badge) {
    return <span className="license-text">{licenseSummary ?? 'not specified'}</span>;
  }

  const label = badge.code === 'by-nc' ? 'Attribution-NonCommercial' : 'Attribution';

  return (
    <span className="license-badge" title={`Creative Commons ${label} ${badge.version}`}>
      <span className="license-badge__cc">CC</span>
      <span className="license-badge__code">{badge.code === 'by-nc' ? 'BY-NC' : 'BY'}</span>
      <span className="license-badge__version">{badge.version}</span>
    </span>
  );
}
