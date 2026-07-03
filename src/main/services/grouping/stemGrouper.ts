import type { Confidence, MetadataSourceType, StemGroup, TrackFile, TrackFileKind, TrackUpload } from '../../../shared/domain';
import type {
  ConfidenceAssessment,
  FileClassificationContext,
  FileClassificationResult,
  GroupingSignal,
  GroupingUploadCandidate,
  StemGroupingResult,
  TitleRootNormalization
} from './groupingTypes';

const FUNCTIONAL_SUFFIX_PATTERN =
  /\s*(?:\((source|sources|stems?|instrumental stems?|pells|acapella|a cappella|vocals|instrumental)\)|\[(source|sources|stems?|instrumental stems?|pells|acapella|a cappella|vocals|instrumental)\]|-\s*(source|sources|stems?))\s*$/i;

const STEM_HINTS = new Set(['stem', 'stems', 'source', 'sources', 'pells', 'acapella', 'a_cappella', 'instrumental', 'vocals']);
const SOURCE_FORMAT_HINTS = new Set(['flac', 'wav', 'aif', 'aiff', 'zip', 'archive', 'multiple_formats']);
const PREVIEW_HINTS = new Set(['preview', 'demo', 'mp3']);
const AUDIO_EXTENSIONS = new Set(['flac', 'wav', 'aif', 'aiff', 'ogg', 'm4a', 'mp3']);

interface NormalizedCandidate {
  upload: TrackUpload;
  files: TrackFile[];
  titleRoot: TitleRootNormalization;
}

export function groupStemUploads(candidates: GroupingUploadCandidate[]): StemGroupingResult {
  const normalizedCandidates = candidates.map((candidate) => normalizeCandidate(candidate));
  const signals = buildGroupingSignals(normalizedCandidates);
  const components = buildComponents(normalizedCandidates, signals);
  const groups = components.map((component, index) => buildGroup(component, signals, index));
  const warnings = groups.flatMap((group) => group.warnings).filter(unique);

  return {
    groups,
    signals,
    warnings
  };
}

export function normalizeTitleRoot(title: string): TitleRootNormalization {
  let normalizedTitle = title.trim().replace(/\s+/g, ' ');
  const removedSuffixes: string[] = [];

  while (FUNCTIONAL_SUFFIX_PATTERN.test(normalizedTitle)) {
    normalizedTitle = normalizedTitle.replace(FUNCTIONAL_SUFFIX_PATTERN, (_match, paren, square, dash) => {
      const suffix = String(paren ?? square ?? dash ?? '').trim();
      if (suffix.length > 0) {
        removedSuffixes.push(suffix);
      }

      return '';
    });
    normalizedTitle = normalizedTitle.trim().replace(/\s+/g, ' ');
  }

  const fallbackTitle = normalizedTitle.length > 0 ? normalizedTitle : 'Untitled Song';
  const changed = fallbackTitle !== title.trim();
  const warnings = changed ? [`Title root normalized from "${title}" to "${fallbackTitle}".`] : [];

  return {
    originalTitle: title,
    normalizedTitle: fallbackTitle,
    changed,
    removedSuffixes,
    warnings
  };
}

export function classifyTrackFile(file: TrackFile, context: FileClassificationContext): TrackFile {
  const classification = classifyTrackFileCandidate(file, context);

  return {
    ...file,
    fileKind: classification.fileKind,
    warnings: [...file.warnings, ...classification.warnings].filter(unique)
  };
}

export function classifyTrackFileCandidate(file: TrackFile, context: FileClassificationContext): FileClassificationResult {
  const haystack = [
    file.originalFilename,
    file.extension,
    file.qualityHint,
    context.uploadTitle,
    context.qualityHint,
    ...context.uploadTags
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, '_');
  const tags = new Set(context.uploadTags.map(normalizeHint));
  const extension = file.extension.toLowerCase();
  const reasons: string[] = [];
  const warnings: string[] = [];
  const hasStemHint = [...STEM_HINTS].some((hint) => tags.has(hint) || haystack.includes(hint));
  const hasSourceFormatHint = [...SOURCE_FORMAT_HINTS].some((hint) => tags.has(hint) || haystack.includes(hint));
  const hasPreviewHint = [...PREVIEW_HINTS].some((hint) => tags.has(hint) || haystack.includes(hint));

  if (extension === 'zip') {
    reasons.push('ZIP extension classified as archive.');
    return { fileKind: 'archive', warnings, reasons };
  }

  if (hasPreviewHint && extension === 'mp3') {
    reasons.push('MP3 with preview hint classified as preview.');
    return { fileKind: 'preview', warnings, reasons };
  }

  if ((extension === 'flac' || extension === 'wav') && (hasStemHint || hasSourceFormatHint)) {
    reasons.push('Lossless audio with stem/source hints classified as stem.');
    return { fileKind: 'stem', warnings, reasons };
  }

  if (AUDIO_EXTENSIONS.has(extension) && hasStemHint) {
    reasons.push('Audio file with stem/source hints classified as stem.');
    return { fileKind: 'stem', warnings, reasons };
  }

  warnings.push('File candidate could not be classified confidently.');
  return { fileKind: 'unknown', warnings, reasons };
}

function normalizeCandidate(candidate: GroupingUploadCandidate): NormalizedCandidate {
  const titleRoot = normalizeTitleRoot(candidate.upload.title);
  const upload = {
    ...candidate.upload,
    warnings: [...candidate.upload.warnings, ...titleRoot.warnings].filter(unique)
  };
  const files = candidate.files.map((file) =>
    classifyTrackFile(file, {
      uploadTags: upload.tags,
      uploadTitle: upload.title,
      qualityHint: file.qualityHint
    })
  );

  return {
    upload,
    files,
    titleRoot
  };
}

function buildGroupingSignals(candidates: NormalizedCandidate[]): GroupingSignal[] {
  const signals: GroupingSignal[] = [];

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex]!;
      const right = candidates[rightIndex]!;
      const pairSignals = compareCandidates(left, right);
      signals.push(...pairSignals);
    }
  }

  return signals;
}

function compareCandidates(left: NormalizedCandidate, right: NormalizedCandidate): GroupingSignal[] {
  const signals: GroupingSignal[] = [];
  const sameArtist = sameArtistIdentity(left.upload, right.upload);
  const sameTitleRoot = left.titleRoot.normalizedTitle.toLowerCase() === right.titleRoot.normalizedTitle.toLowerCase();
  const similarTitleRoot = areWeaklySimilarTitles(left.titleRoot.normalizedTitle, right.titleRoot.normalizedTitle);
  const bpmClose = areBpmsClose(left.upload.bpm, right.upload.bpm);
  const relatedByHtml = hasRelatedUploadLink(left.upload, right.upload);
  const relatedByApi = hasApiRelationship(left.upload, right.upload);
  const uploadedClose = areUploadTimesClose(left.upload.uploadedAt, right.upload.uploadedAt);

  if (sameArtist && sameTitleRoot) {
    signals.push(signal(left, right, 'strong', 'Same artist and normalized song title root.'));
  } else if (sameArtist && similarTitleRoot) {
    signals.push(signal(left, right, 'weak', 'Same artist with weak title-root similarity.'));
  }

  if (bpmClose) {
    signals.push(signal(left, right, 'medium', 'BPM values match or are very similar.'));
  }

  if (relatedByHtml) {
    signals.push(signal(left, right, sameArtist || sameTitleRoot ? 'medium' : 'weak', 'Related upload link was detected in HTML enrichment.'));
  }

  if (relatedByApi) {
    signals.push(signal(left, right, 'medium', 'API source/remix relationship references another upload in this group.'));
  }

  if (uploadedClose && sameArtist) {
    signals.push(signal(left, right, 'weak', 'Upload dates are close.'));
  }

  return signals;
}

function buildComponents(candidates: NormalizedCandidate[], signals: GroupingSignal[]): NormalizedCandidate[][] {
  const parent = candidates.map((_candidate, index) => index);
  const uploadIndex = new Map(candidates.map((candidate, index) => [candidate.upload.uploadId, index]));

  for (const signal of signals) {
    if (signal.strength === 'weak' && signal.reason !== 'Related upload link was detected in HTML enrichment.') {
      continue;
    }

    const fromIndex = uploadIndex.get(signal.fromUploadId);
    const toIndex = uploadIndex.get(signal.toUploadId);

    if (fromIndex !== undefined && toIndex !== undefined) {
      union(parent, fromIndex, toIndex);
    }
  }

  const components = new Map<number, NormalizedCandidate[]>();
  for (let index = 0; index < candidates.length; index += 1) {
    const root = find(parent, index);
    const existing = components.get(root) ?? [];
    existing.push(candidates[index]!);
    components.set(root, existing);
  }

  return [...components.values()];
}

function buildGroup(component: NormalizedCandidate[], signals: GroupingSignal[], index: number): StemGroup {
  const first = component[0]!;
  const uploads = component.map((candidate) => candidate.upload);
  const files = component.flatMap((candidate) => candidate.files);
  const componentSignals = signals.filter((signal) =>
    uploads.some((upload) => upload.uploadId === signal.fromUploadId) && uploads.some((upload) => upload.uploadId === signal.toUploadId)
  );
  const assessment = assessConfidence(component, componentSignals, files);
  const canonicalSongTitle = chooseCanonicalTitle(component);
  const bpm = chooseBpm(uploads);
  const metadataSource = uploads.reduce<MetadataSourceType>(
    (source, upload) => combineSource(source, upload.metadataSource),
    first.upload.metadataSource
  );
  const warnings = [
    ...uploads.flatMap((upload) => upload.warnings),
    ...assessment.warnings,
    ...files.flatMap((file) => file.warnings)
  ].filter(unique);

  return {
    groupId: `ccmixter-${first.upload.artistLogin}-${index}-${canonicalSongTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    artist: first.upload.artistName,
    canonicalSongTitle,
    bpm,
    uploads,
    files,
    confidence: assessment.confidence,
    metadataSource,
    groupingReasons: assessment.reasons.filter(unique),
    ambiguousUploads: assessment.ambiguousUploads,
    unverifiedFields: assessment.unverifiedFields.filter(unique),
    warnings
  };
}

function assessConfidence(
  component: NormalizedCandidate[],
  signals: GroupingSignal[],
  files: TrackFile[]
): ConfidenceAssessment {
  const uploads = component.map((candidate) => candidate.upload);
  const reasons = signals.map((signal) => signal.reason);
  const warnings: string[] = [];
  const unverifiedFields: string[] = [];
  const ambiguousUploads: TrackUpload[] = [];
  const hasStrongSignal = signals.some((signal) => signal.strength === 'strong');
  const hasMediumSignal = signals.some((signal) => signal.strength === 'medium');
  const hasStemOrSourceHint = uploads.some((upload) => hasAnyHint(upload.tags, STEM_HINTS) || hasAnyHint(upload.tags, SOURCE_FORMAT_HINTS));
  const hasMissingBpm = uploads.some((upload) => typeof upload.bpm !== 'number');
  const hasMixedPreviewAndSource = hasMixedFileKinds(files);
  const titleRoots = new Set(component.map((candidate) => candidate.titleRoot.normalizedTitle.toLowerCase()));

  if (component.some((candidate) => candidate.titleRoot.changed)) {
    reasons.push('Functional title suffix was removed for song-root grouping.');
  }

  if (hasStemOrSourceHint) {
    reasons.push('Stem/source tags or file-format hints support this group.');
  }

  if (hasMissingBpm) {
    warnings.push('BPM missing for one or more uploads.');
    unverifiedFields.push('bpm');
  }

  if (files.length === 0) {
    warnings.push('No file candidates are available for this upload.');
    unverifiedFields.push('files');
  }

  if (hasMixedPreviewAndSource) {
    warnings.push('Preview and source files are mixed in this group.');
  }

  if (signals.some((signal) => signal.reason === 'Related upload link was detected in HTML enrichment.')) {
    warnings.push('Related upload link detected but not recursively resolved.');
  }

  if (titleRoots.size > 1) {
    warnings.push('Multiple possible song roots are present in this group.');
    ambiguousUploads.push(...uploads);
  }

  if (uploads.some((upload) => upload.licenseSummary === 'not specified')) {
    unverifiedFields.push('licenseSummary');
  }

  if (uploads.length === 1) {
    return {
      confidence: files.length > 0 && hasStemOrSourceHint && !hasMissingBpm ? 'medium' : 'low',
      reasons: reasons.length > 0 ? reasons : ['Single upload group; no sibling upload relationship was verified.'],
      warnings,
      ambiguousUploads,
      unverifiedFields
    };
  }

  const confidence: Confidence =
    titleRoots.size > 1 && !hasStrongSignal
      ? 'low'
      : hasStrongSignal && hasMediumSignal && hasStemOrSourceHint && !hasMissingBpm && titleRoots.size === 1
      ? 'high'
      : hasStrongSignal || hasMediumSignal
        ? 'medium'
        : 'low';

  return {
    confidence,
    reasons,
    warnings,
    ambiguousUploads,
    unverifiedFields
  };
}

function chooseCanonicalTitle(component: NormalizedCandidate[]): string {
  const titleCounts = new Map<string, number>();

  for (const candidate of component) {
    titleCounts.set(candidate.titleRoot.normalizedTitle, (titleCounts.get(candidate.titleRoot.normalizedTitle) ?? 0) + 1);
  }

  return [...titleCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'Untitled Song';
}

function chooseBpm(uploads: TrackUpload[]): number | undefined {
  const bpms = uploads.map((upload) => upload.bpm).filter((bpm): bpm is number => typeof bpm === 'number');

  if (bpms.length === 0) {
    return undefined;
  }

  return Math.round(bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length);
}

function signal(left: NormalizedCandidate, right: NormalizedCandidate, strength: GroupingSignal['strength'], reason: string): GroupingSignal {
  return {
    fromUploadId: left.upload.uploadId,
    toUploadId: right.upload.uploadId,
    strength,
    reason
  };
}

function sameArtistIdentity(left: TrackUpload, right: TrackUpload): boolean {
  return (
    left.artistLogin.trim().toLowerCase() === right.artistLogin.trim().toLowerCase() ||
    left.artistName.trim().toLowerCase() === right.artistName.trim().toLowerCase()
  );
}

function areBpmsClose(left: number | undefined, right: number | undefined): boolean {
  return typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) <= 2;
}

function areWeaklySimilarTitles(left: string, right: string): boolean {
  const leftTokens = tokenizeTitle(left);
  const rightTokens = tokenizeTitle(right);
  const shared = leftTokens.filter((token) => rightTokens.includes(token));

  return shared.length >= 2 && shared.length / Math.max(leftTokens.length, rightTokens.length) >= 0.6;
}

function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function hasRelatedUploadLink(left: TrackUpload, right: TrackUpload): boolean {
  const leftUrls = left.relatedUploadUrls ?? [];
  const rightUrls = right.relatedUploadUrls ?? [];

  return leftUrls.includes(right.sourceUrl) || rightUrls.includes(left.sourceUrl);
}

function hasApiRelationship(left: TrackUpload, right: TrackUpload): boolean {
  const leftRelationships = [...(left.sourceUploadIds ?? []), ...(left.remixOfUploadIds ?? [])];
  const rightRelationships = [...(right.sourceUploadIds ?? []), ...(right.remixOfUploadIds ?? [])];

  return leftRelationships.includes(right.uploadId) || rightRelationships.includes(left.uploadId);
}

function areUploadTimesClose(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }

  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  return Math.abs(leftTime - rightTime) <= fourteenDaysMs;
}

function hasAnyHint(tags: string[], hints: Set<string>): boolean {
  return tags.map(normalizeHint).some((tag) => hints.has(tag));
}

function normalizeHint(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function hasMixedFileKinds(files: TrackFile[]): boolean {
  const kinds = new Set(files.map((file) => file.fileKind));
  return kinds.has('preview') && (kinds.has('stem') || kinds.has('archive'));
}

function combineSource(left: MetadataSourceType, right: MetadataSourceType): MetadataSourceType {
  if (left === 'html-enriched' || right === 'html-enriched') {
    return 'html-enriched';
  }

  if (left === 'api' || right === 'api') {
    return 'api';
  }

  if (left === 'fixture' || right === 'fixture') {
    return 'fixture';
  }

  return 'unresolved';
}

function find(parent: number[], index: number): number {
  if (parent[index] !== index) {
    parent[index] = find(parent, parent[index]!);
  }

  return parent[index]!;
}

function union(parent: number[], left: number, right: number): void {
  parent[find(parent, right)] = find(parent, left);
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}
