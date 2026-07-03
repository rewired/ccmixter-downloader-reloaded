import { RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING, type MetadataSourceType, type TrackFile, type TrackFileKind } from '../../../shared/domain';
import type {
  CcmixterApiClientOptions,
  CcmixterApiQuery,
  CcmixterApiUploadMapping,
  RawCcmixterApiUpload
} from './ccmixterTypes';

const DEFAULT_QUERY_API_URL = 'https://ccmixter.org/api/query';
const DEFAULT_TIMEOUT_MS = 10_000;
export const ARTIST_CATALOG_QUERY_LIMIT = 100;
const AUDIO_OR_ARCHIVE_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'aif', 'aiff', 'ogg', 'm4a', 'zip']);

export class CcmixterApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CcmixterApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_QUERY_API_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async resolveByArtistLogin(artistLogin: string): Promise<CcmixterApiUploadMapping[]> {
    const url = buildCcmixterQueryUrl({ artistLogin, dataview: 'info', limit: ARTIST_CATALOG_QUERY_LIMIT }, this.baseUrl);
    const response = await this.fetchJson(url);
    return parseCcmixterApiResponse(response).map((upload) => mapRawApiUpload(upload));
  }

  async resolveByUploadId(uploadId: string): Promise<CcmixterApiUploadMapping[]> {
    const url = buildCcmixterQueryUrl({ uploadId, dataview: 'info', limit: 1 }, this.baseUrl);
    const response = await this.fetchJson(url);
    return parseCcmixterApiResponse(response).map((upload) => mapRawApiUpload(upload));
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`ccMixter API request failed with HTTP ${response.status}.`);
      }

      return response.json() as Promise<unknown>;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`ccMixter API request timed out after ${this.timeoutMs} ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function buildCcmixterQueryUrl(query: CcmixterApiQuery, baseUrl = DEFAULT_QUERY_API_URL): URL {
  const url = new URL(baseUrl);
  url.searchParams.set('f', 'json');
  url.searchParams.set('dataview', query.dataview ?? 'info');

  if (query.artistLogin) {
    url.searchParams.set('user', query.artistLogin);
  }

  if (query.uploadId) {
    url.searchParams.set('ids', query.uploadId);
  }

  if (typeof query.limit === 'number') {
    url.searchParams.set('limit', String(query.limit));
  }

  return url;
}

export function parseCcmixterApiResponse(response: unknown): RawCcmixterApiUpload[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }

  if (!isRecord(response)) {
    throw new Error('ccMixter API response was not JSON object or array data.');
  }

  for (const key of ['results', 'records', 'uploads', 'items']) {
    const value = response[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  if (hasAnyKey(response, ['upload_id', 'id', 'upload_name', 'title'])) {
    return [response];
  }

  throw new Error('ccMixter API response did not contain upload records.');
}

export function mapRawApiUpload(raw: RawCcmixterApiUpload): CcmixterApiUploadMapping {
  const warnings: string[] = [];
  const uploadId = stringFrom(raw, ['upload_id', 'id']);
  const artistLogin = stringFrom(raw, ['user_name', 'user_login', 'artist_login', 'login']);
  const artistName = stringFrom(raw, ['user_real_name', 'user_realname', 'artist_name', 'user_name', 'user_login']);
  const title = stringFrom(raw, ['upload_name', 'title', 'name']);
  const bpm = numberFrom(raw, ['upload_bpm', 'bpm', 'tempo']);
  const tags = tagsFrom(raw, ['upload_tags', 'tags', 'tag_list']);
  const licenseSummary = stringFrom(raw, ['license_name', 'license_url', 'upload_license', 'license']);
  const sourceUrl = stringFrom(raw, ['file_page_url', 'upload_url', 'source_url', 'url']);
  const uploadedAt = stringFrom(raw, ['upload_date', 'upload_published', 'created_at', 'date']);
  const sourceUploadIds = stringArrayFrom(raw, ['sources', 'source_ids', 'source_upload_ids', 'upload_sources', 'remix_parents']);
  const remixOfUploadIds = stringArrayFrom(raw, ['remixes', 'remix_of', 'remix_of_upload_ids', 'upload_remixes', 'remix_parents']);
  const relatedUploadUrls = stringArrayFrom(raw, ['related_upload_urls']).concat(
    uploadUrlsFrom(raw, ['remix_children', 'remix_parents'])
  );

  if (!uploadId) {
    warnings.push('API upload record did not include a recognized upload ID field.');
  }

  if (!artistLogin) {
    warnings.push('API upload record did not include a recognized artist login field.');
  }

  if (!artistName) {
    warnings.push('API upload record did not include a recognized artist display name field.');
  }

  if (!title) {
    warnings.push('API upload record did not include a recognized title field.');
  }

  if (typeof bpm !== 'number') {
    warnings.push('API upload record did not include a recognized BPM field.');
  }

  if (tags.length === 0) {
    warnings.push('API upload record did not include recognized tags.');
  }

  if (!licenseSummary) {
    warnings.push('API upload record did not include a recognized license summary or URL.');
  }

  const effectiveArtistLogin = artistLogin ?? 'unknown_artist';
  const effectiveUploadId = uploadId ?? 'unknown-upload';
  const effectiveSourceUrl =
    sourceUrl ?? `https://ccmixter.org/files/${encodeURIComponent(effectiveArtistLogin)}/${encodeURIComponent(effectiveUploadId)}`;

  if (!sourceUrl) {
    warnings.push('Source URL was constructed from available upload fields and has not been verified by the API.');
  }

  if (relatedUploadUrls.length > 0) {
    warnings.push(RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING);
  }

  const files = mapRawFiles(raw, warnings);

  return {
    upload: {
      uploadId: effectiveUploadId,
      artistName: artistName ?? 'Unknown artist',
      artistLogin: effectiveArtistLogin,
      title: title ?? `ccMixter upload ${effectiveUploadId}`,
      bpm,
      tags,
      licenseSummary: licenseSummary ?? 'not specified',
      sourceUrl: effectiveSourceUrl,
      metadataSource: 'api',
      uploadedAt,
      relatedUploadUrls,
      sourceUploadIds,
      remixOfUploadIds,
      warnings
    },
    files,
    warnings
  };
}

function mapRawFiles(raw: RawCcmixterApiUpload, warnings: string[]): TrackFile[] {
  const entries = arrayFrom(raw, ['files', 'upload_files', 'file_list']);
  const mapped = entries.map((entry) => mapFileRecord(entry)).filter((file): file is TrackFile => file !== null);
  const uploadDownloadUrl = stringFrom(raw, ['download_url', 'upload_download_url']);

  if (mapped.length === 0 && uploadDownloadUrl) {
    const filename = filenameFromUrl(uploadDownloadUrl) ?? stringFrom(raw, ['upload_name', 'title', 'name']);
    if (filename) {
      mapped.push(buildTrackFile(filename, uploadDownloadUrl, 'api', ['File candidate came from an upload-level API download URL.']));
    }
  }

  if (mapped.length === 0) {
    warnings.push('No downloadable file candidates were mapped from recognized API fields.');
  }

  return mapped;
}

function mapFileRecord(record: unknown): TrackFile | null {
  if (!isRecord(record)) {
    return null;
  }

  const downloadUrl = stringFrom(record, ['download_url', 'file_url', 'url']);
  const filename = stringFrom(record, ['file_name', 'filename', 'upload_file_name', 'name']) ?? filenameFromUrl(downloadUrl);

  if (!filename) {
    return null;
  }

  const warnings = downloadUrl ? [] : ['File candidate did not include a recognized download URL field.'];
  const sizeBytes = numberFrom(record, ['file_size', 'size', 'size_bytes', 'file_rawsize']);
  const file = buildTrackFile(filename, downloadUrl, 'api', warnings);

  return {
    ...file,
    sizeBytes
  };
}

export function buildTrackFile(
  filename: string,
  downloadUrl: string | undefined,
  metadataSource: MetadataSourceType,
  warnings: string[] = []
): TrackFile {
  const extension = extensionFromFilename(filename);

  return {
    originalFilename: filename,
    fileKind: inferFileKind(filename),
    extension: extension ?? 'unknown',
    downloadUrl,
    metadataSource,
    warnings: extension ? warnings : [...warnings, 'File extension could not be determined.']
  };
}

function inferFileKind(filename: string): TrackFileKind {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.zip')) {
    return 'archive';
  }

  if (lower.includes('preview') || lower.includes('demo')) {
    return 'preview';
  }

  const extension = extensionFromFilename(filename);
  if (extension && AUDIO_OR_ARCHIVE_EXTENSIONS.has(extension)) {
    return 'stem';
  }

  return 'unknown';
}

function extensionFromFilename(filename: string): string | undefined {
  const clean = filename.split(/[?#]/)[0] ?? filename;
  const dotIndex = clean.lastIndexOf('.');

  if (dotIndex < 0 || dotIndex === clean.length - 1) {
    return undefined;
  }

  return clean.slice(dotIndex + 1).toLowerCase();
}

function filenameFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value, 'https://ccmixter.org');
    const lastPart = parsed.pathname.split('/').filter(Boolean).at(-1);
    return lastPart ? decodeURIComponent(lastPart) : undefined;
  } catch {
    return undefined;
  }
}

function stringFrom(record: RawCcmixterApiUpload, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function numberFrom(record: RawCcmixterApiUpload, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function tagsFrom(record: RawCcmixterApiUpload, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim());
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value
        .split(/[,\s]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
    }
  }

  return [];
}

function stringArrayFrom(record: RawCcmixterApiUpload, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value
        .flatMap((item) => {
          if (typeof item === 'string' || typeof item === 'number') {
            return [String(item).trim()];
          }

          if (isRecord(item)) {
            const id = stringFrom(item, ['upload_id', 'id']);
            return id ? [id] : [];
          }

          return [];
        })
        .filter((item) => item.length > 0);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
  }

  return [];
}

function uploadUrlsFrom(record: RawCcmixterApiUpload, keys: string[]): string[] {
  const urls: string[] = [];

  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const item of value) {
      if (isRecord(item)) {
        const url = stringFrom(item, ['file_page_url', 'upload_url', 'source_url', 'url']);
        if (url) {
          urls.push(url);
        }
      }
    }
  }

  return urls.filter((url, index, all) => all.indexOf(url) === index);
}

function arrayFrom(record: RawCcmixterApiUpload, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function hasAnyKey(record: RawCcmixterApiUpload, keys: string[]): boolean {
  return keys.some((key) => record[key] !== undefined);
}

function isRecord(value: unknown): value is RawCcmixterApiUpload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
