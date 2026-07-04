import type {
  CcmixterInput,
  DryRunPlan,
  MetadataSourceType,
  PlannedFile,
  StemGroup,
  StemLibraryRoot,
  TrackFile
} from './models';
import { withDownloadCandidateClassification } from './classification';

export const ARTIST_SCAN_REALITY_CHECK_WARNING =
  'Artist scan may include previews, remixes, and non-stem uploads. Review carefully before downloading.';
export const ARTIST_SCAN_PAGINATION_WARNING = 'Artist catalog paging stopped before completion. Results may be incomplete.';
export const RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING = 'Related uploads are detected but not recursively resolved.';
export const ARTIST_CATALOG_NO_STEM_EVIDENCE_WARNING =
  'Artist catalog group has no explicit source, stem, or archive evidence.';

const SOURCE_SUFFIX_PATTERN =
  /\s*(?:\((?:source|sources|stems?|instrumental stems?|pells|acapella|a cappella|vocals|instrumental)\)|\[(?:source|sources|stems?|instrumental stems?|pells|acapella|a cappella|vocals|instrumental)\]|-\s*(?:source|sources|stems?))\s*$/i;

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
]);

export function parseCcmixterInput(raw: string): CcmixterInput {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return {
      raw,
      kind: 'unknown',
      warnings: ['Input is empty.']
    };
  }

  const fixtureMatch = /^fixture:([a-z0-9][a-z0-9._-]*)$/i.exec(trimmed);
  if (fixtureMatch) {
    return {
      raw,
      kind: 'fixture',
      fixtureId: fixtureMatch[1]!.toLowerCase(),
      warnings: ['Fixture input is sample data for smoke testing and is not live ccMixter resolution.']
    };
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      raw,
      kind: 'upload-id',
      uploadId: trimmed,
      warnings: ['Upload ID is parsed locally; ccMixter metadata has not been verified.']
    };
  }

  const urlInput = parseUrl(trimmed);
  if (urlInput) {
    return urlInput;
  }

  if (/^[a-zA-Z0-9][a-zA-Z0-9._ -]{1,63}$/.test(trimmed) && /[a-zA-Z]/.test(trimmed)) {
    const artistLogin = preserveArtistLogin(trimmed);

    return {
      raw,
      kind: 'artist-name',
      artistLogin,
      normalizedArtistLogin: normalizeArtistLogin(artistLogin),
      warnings: ['Artist name is parsed locally; ccMixter artist identity has not been verified.']
    };
  }

  return {
    raw,
    kind: 'unknown',
    warnings: ['Input is ambiguous and was not recognized as a ccMixter artist, upload link, or upload ID.']
  };
}

export function isArtistCatalogInput(input: CcmixterInput): boolean {
  return input.kind === 'artist-link' || input.kind === 'artist-name';
}

export function normalizeSongTitle(title: string): string {
  let normalized = title.trim().replace(/\s+/g, ' ');

  while (SOURCE_SUFFIX_PATTERN.test(normalized)) {
    normalized = normalized.replace(SOURCE_SUFFIX_PATTERN, '').trim();
  }

  return normalized.length > 0 ? normalized : 'Untitled Song';
}

export function sanitizePathSegment(value: string): string {
  const withoutInvalidCharacters = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ .]+$/g, '');

  const collapsed = withoutInvalidCharacters.replace(/-+/g, '-').replace(/-+$/g, '').trim();
  const candidate = collapsed.length > 0 ? collapsed : 'untitled';
  const deviceName = candidate.split('.')[0]?.toUpperCase() ?? candidate.toUpperCase();

  if (WINDOWS_RESERVED_NAMES.has(deviceName)) {
    return `_${candidate}`;
  }

  return candidate;
}

export function buildSongFolderName(title: string, bpm?: number): string {
  const safeTitle = sanitizePathSegment(normalizeSongTitle(title));
  return typeof bpm === 'number' ? `${safeTitle} (${bpm} bpm)` : safeTitle;
}

export function buildPlannedTargetPath(group: StemGroup, file: TrackFile): string {
  const artist = sanitizePathSegment(group.artist);
  const songFolder = buildSongFolderName(group.canonicalSongTitle, group.bpm);
  const filename = sanitizePathSegment(file.originalFilename);

  return [artist, songFolder, filename].join('/');
}

export function createDryRunPlanFromFixture(
  rawInput: string,
  stemLibraryRoot: StemLibraryRoot,
  groups: StemGroup[],
  createdAt = new Date().toISOString()
): DryRunPlan {
  return createDryRunPlanFromGroups(rawInput, stemLibraryRoot, groups, {
    createdAt,
    metadataSource: 'fixture',
    placeholderData: true,
    resolverStatus: 'fixture',
    warnings: [
      'Dry run only: fixture/sample data is shown as a placeholder.',
      'No ccMixter scan happened.',
      'No files will be downloaded.',
      'No ZIP extraction happened.',
      'No attribution files were written.'
    ]
  });
}

export function createDryRunPlanFromGroups(
  rawInput: string,
  stemLibraryRoot: StemLibraryRoot,
  groups: StemGroup[],
  options: {
    createdAt?: string;
    input?: CcmixterInput;
    metadataSource: MetadataSourceType;
    placeholderData: boolean;
    resolverStatus: DryRunPlan['resolverStatus'];
    warnings: string[];
  }
): DryRunPlan {
  const input = options.input ?? parseCcmixterInput(rawInput);
  const classifiedGroups = groups.map((group) => classifyGroupFiles(group));
  const plannedFiles: PlannedFile[] = classifiedGroups.flatMap((group) =>
    group.files.map((sourceFile) => {
      const targetRelativePath = buildPlannedTargetPath(group, sourceFile);

      return {
        sourceFile,
        targetRelativePath,
        targetAbsolutePath: joinDomainPath(stemLibraryRoot.path, targetRelativePath),
        conflictStatus: 'not-checked',
        warnings: ['Conflict status is not checked in this dry-run foundation slice.']
      };
    })
  );

  return {
    input,
    stemLibraryRoot,
    targetDirectory: stemLibraryRoot.path,
    groups: classifiedGroups,
    plannedFiles,
    warnings: options.warnings,
    createdAt: options.createdAt ?? new Date().toISOString(),
    placeholderData: options.placeholderData,
    resolverStatus: options.resolverStatus,
    metadataSource: options.metadataSource
  };
}

function classifyGroupFiles(group: StemGroup): StemGroup {
  const uploadTags = group.uploads.flatMap((upload) => upload.tags);
  const uploadTitle = group.uploads.map((upload) => upload.title).join(' ');

  return {
    ...group,
    files: group.files.map((file) =>
      withDownloadCandidateClassification(file, {
        uploadTags,
        uploadTitle,
        fileLabel: file.displayLabel,
        qualityHint: file.qualityHint,
        zipFileHints: file.zipFileHints,
        metadataSource: file.metadataSource
      })
    )
  };
}

function parseUrl(raw: string): CcmixterInput | null {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!isAllowedCcmixterHostname(host)) {
    return {
      raw,
      kind: 'unknown',
      sourceUrl: parsed.toString(),
      warnings: ['URL is not a ccMixter URL.']
    };
  }

  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const uploadId = findUploadId(pathParts, parsed.searchParams);

  if (uploadId) {
    return {
      raw,
      kind: 'upload-link',
      uploadId,
      sourceUrl: parsed.toString(),
      warnings: ['Upload link is parsed locally; ccMixter metadata has not been verified.']
    };
  }

  const peopleIndex = pathParts.findIndex((part) => part.toLowerCase() === 'people');
  const artistFromPeople = peopleIndex >= 0 ? pathParts[peopleIndex + 1] : undefined;
  const artistFromFiles = pathParts[0]?.toLowerCase() === 'files' ? pathParts[1] : undefined;
  const artist = artistFromPeople ?? artistFromFiles;

  if (artist && !/^\d+$/.test(artist)) {
    const artistLogin = preserveArtistLogin(decodeURIComponent(artist));

    return {
      raw,
      kind: 'artist-link',
      artistLogin,
      normalizedArtistLogin: normalizeArtistLogin(artistLogin),
      sourceUrl: parsed.toString(),
      warnings: ['Artist link is parsed locally; ccMixter artist identity has not been verified.']
    };
  }

  return {
    raw,
    kind: 'unknown',
    sourceUrl: parsed.toString(),
    warnings: ['ccMixter URL was not recognized as an artist or upload link.']
  };
}

function findUploadId(pathParts: string[], searchParams: URLSearchParams): string | undefined {
  const uploadIdParam = searchParams.get('id') ?? searchParams.get('upload');
  if (uploadIdParam && /^\d+$/.test(uploadIdParam)) {
    return uploadIdParam;
  }

  const filesIndex = pathParts.findIndex((part) => part.toLowerCase() === 'files');
  if (filesIndex >= 0) {
    const maybeUploadId = pathParts[filesIndex + 2];
    if (maybeUploadId && /^\d+$/.test(maybeUploadId)) {
      return maybeUploadId;
    }
  }

  const numericPart = pathParts.find((part) => /^\d+$/.test(part));
  return numericPart;
}

function isAllowedCcmixterHostname(hostname: string): boolean {
  return hostname === 'ccmixter.org' || hostname.endsWith('.ccmixter.org');
}

function normalizeArtistLogin(value: string): string {
  return value.trim().replace(/\s+/g, '_').toLowerCase();
}

function preserveArtistLogin(value: string): string {
  return value.trim().replace(/\s+/g, '_');
}

function joinDomainPath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/g, '');
  return `${normalizedRoot}/${relativePath}`;
}
