import type {
  DownloadCandidateClassification,
  DownloadCandidateFormat,
  DownloadCandidateQuality,
  DownloadCandidateRole,
  MetadataSourceType,
  TrackFile,
  TrackFileKind
} from './models';

export interface DownloadCandidateClassificationContext {
  uploadTags?: string[];
  uploadTitle?: string;
  fileLabel?: string;
  qualityHint?: string;
  zipFileHints?: string[];
  metadataSource?: MetadataSourceType;
}

const SOURCE_HINTS = new Set(['source', 'sources', 'pells', 'pell', 'acapella', 'a_cappella', 'a-cappella', 'instrumental']);
const STEM_HINTS = new Set(['stem', 'stems', 'vocals', 'vocal', 'bass', 'drums', 'guitar', 'keys', 'loops']);
const ARCHIVE_HINTS = new Set(['archive', 'zip']);
const PREVIEW_HINTS = new Set(['preview', 'demo', 'play', 'stream']);
const LOSSLESS_EXTENSIONS = new Set(['flac', 'wav', 'aif', 'aiff']);

export function classifyDownloadCandidate(
  file: Pick<
    TrackFile,
    'originalFilename' | 'extension' | 'fileKind' | 'qualityHint' | 'metadataSource' | 'zipFileHints' | 'displayLabel'
  >,
  context: DownloadCandidateClassificationContext = {}
): DownloadCandidateClassification {
  const extension = normalizeExtension(file.extension);
  const format = formatFromExtension(extension);
  const quality = qualityFromFormat(format);
  const tags = new Set((context.uploadTags ?? []).map(normalizeHint));
  const searchableText = [
    file.originalFilename,
    file.displayLabel,
    file.extension,
    file.qualityHint,
    context.fileLabel,
    context.qualityHint,
    context.uploadTitle,
    ...(context.uploadTags ?? []),
    ...(context.zipFileHints ?? file.zipFileHints ?? [])
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
  const searchableHints = searchableText.replace(/[^a-z0-9]+/g, '_');
  const reasons: string[] = [];
  const warnings: string[] = [];
  const hasSourceEvidence = hasHint(tags, searchableHints, SOURCE_HINTS);
  const hasStemEvidence = hasHint(tags, searchableHints, STEM_HINTS);
  const hasArchiveEvidence =
    extension === 'zip' ||
    file.fileKind === 'archive' ||
    hasHint(tags, searchableHints, ARCHIVE_HINTS) ||
    (file.zipFileHints?.length ?? context.zipFileHints?.length ?? 0) > 0;
  const hasPreviewEvidence = file.fileKind === 'preview' || hasHint(tags, searchableHints, PREVIEW_HINTS);

  if (extension === 'zip') {
    reasons.push('ZIP extension classified as archive.');
    if (hasSourceEvidence || hasStemEvidence || (file.zipFileHints?.length ?? context.zipFileHints?.length ?? 0) > 0) {
      reasons.push('Archive has source/stem evidence from tags, labels, or ZIP file hints.');
    }
    return { role: 'archive', format, quality: 'archive', confidence: 'high', reasons, warnings };
  }

  if (format === 'mp3' && hasPreviewEvidence) {
    reasons.push('MP3 with preview evidence classified as preview.');
    return { role: 'preview', format, quality, confidence: 'high', reasons, warnings };
  }

  if (LOSSLESS_EXTENSIONS.has(extension) && hasSourceEvidence) {
    reasons.push('Lossless audio with source evidence classified as source.');
    return { role: 'source', format, quality, confidence: 'high', reasons, warnings };
  }

  if (LOSSLESS_EXTENSIONS.has(extension) && hasStemEvidence) {
    reasons.push('Lossless audio with stem evidence classified as stem.');
    return { role: 'stem', format, quality, confidence: 'high', reasons, warnings };
  }

  if (format === 'mp3' && hasSourceEvidence) {
    reasons.push('MP3 has source evidence but remains lossy; classified as source for review.');
    return { role: 'source', format, quality, confidence: 'medium', reasons, warnings };
  }

  if (format === 'mp3' && hasStemEvidence) {
    reasons.push('MP3 has stem evidence but remains lossy; classified as stem for review.');
    return { role: 'stem', format, quality, confidence: 'medium', reasons, warnings };
  }

  if (hasArchiveEvidence) {
    reasons.push('Archive metadata hint classified this candidate as archive.');
    return { role: 'archive', format, quality: 'archive', confidence: extension === 'unknown' ? 'low' : 'medium', reasons, warnings };
  }

  if (format === 'mp3') {
    reasons.push('MP3 without source/stem evidence classified as preview candidate.');
    warnings.push('MP3 candidate has no explicit source or stem evidence.');
    return { role: 'preview', format, quality, confidence: 'low', reasons, warnings };
  }

  if (LOSSLESS_EXTENSIONS.has(extension)) {
    reasons.push('Lossless audio lacks source/stem evidence; classified as other for review.');
    warnings.push('Lossless candidate has no explicit source or stem evidence.');
    return { role: 'other', format, quality, confidence: 'low', reasons, warnings };
  }

  reasons.push('Unknown or unsupported extension classified as other.');
  warnings.push('File candidate could not be classified confidently.');
  return { role: 'other', format, quality: 'unknown', confidence: 'low', reasons, warnings };
}

export function withDownloadCandidateClassification(
  file: TrackFile,
  context: DownloadCandidateClassificationContext = {}
): TrackFile {
  const classification = classifyDownloadCandidate(file, context);

  return {
    ...file,
    fileKind: fileKindFromDownloadCandidateRole(classification.role),
    classification,
    warnings: [...file.warnings, ...classification.warnings].filter(unique)
  };
}

export function getDownloadCandidateClassification(file: TrackFile): DownloadCandidateClassification {
  return file.classification ?? classifyDownloadCandidate(file);
}

export function isRecommendedDownloadCandidate(file: TrackFile): boolean {
  if (!file.downloadUrl || !isAllowedCandidateUrl(file.downloadUrl)) {
    return false;
  }

  const classification = getDownloadCandidateClassification(file);

  if (classification.role === 'source' || classification.role === 'stem') {
    return true;
  }

  if (classification.role !== 'archive') {
    return false;
  }

  return hasArchiveSourceStemEvidence(file, classification);
}

export function fileKindFromDownloadCandidateRole(role: DownloadCandidateRole): TrackFileKind {
  if (role === 'source' || role === 'stem') {
    return 'stem';
  }

  if (role === 'archive') {
    return 'archive';
  }

  if (role === 'preview') {
    return 'preview';
  }

  return 'unknown';
}

function hasArchiveSourceStemEvidence(file: TrackFile, classification: DownloadCandidateClassification): boolean {
  return (
    (file.zipFileHints?.length ?? 0) > 0 ||
    classification.reasons.some((reason) => /\bsource\b|\bstem\b/i.test(reason)) ||
    /\b(stems?|sources?|pells?|acapp?ella|instrumental)\b/i.test(`${file.originalFilename} ${file.displayLabel ?? ''}`)
  );
}

function formatFromExtension(extension: string): DownloadCandidateFormat {
  if (extension === 'mp3' || extension === 'flac' || extension === 'wav' || extension === 'zip') {
    return extension;
  }

  if (extension === 'aif' || extension === 'aiff') {
    return 'aiff';
  }

  return 'other';
}

function qualityFromFormat(format: DownloadCandidateFormat): DownloadCandidateQuality {
  if (format === 'flac' || format === 'wav' || format === 'aiff') {
    return 'lossless';
  }

  if (format === 'mp3') {
    return 'lossy';
  }

  if (format === 'zip') {
    return 'archive';
  }

  return 'unknown';
}

function normalizeExtension(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/^\./, '') || 'unknown';
}

function hasHint(tags: Set<string>, searchableHints: string, hints: Set<string>): boolean {
  for (const hint of hints) {
    if (tags.has(hint) || searchableHints.includes(hint.replace(/[^a-z0-9]+/g, '_'))) {
      return true;
    }
  }

  return false;
}

function normalizeHint(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function isAllowedCandidateUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && (host === 'ccmixter.org' || host.endsWith('.ccmixter.org'));
  } catch {
    return false;
  }
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}
