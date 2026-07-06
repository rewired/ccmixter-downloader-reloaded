import { buildCcmixterQueryUrl, buildTrackFile, mapRawApiUpload, parseCcmixterApiResponse } from './ccmixterApiClient';
import type {
  CcmixterHtmlCatalogResult,
  CcmixterHtmlClientOptions,
  CcmixterHtmlEnrichment,
  HtmlFileCandidate
} from './ccmixterTypes';

const DEFAULT_TIMEOUT_MS = 10_000;
const FILE_LINK_PATTERN = /\.(?:mp3|flac|wav|aif|aiff|ogg|m4a|zip)(?:[?#][^"'\s<>]*)?$/i;
const BPM_PATTERN = /\b(?:bpm|tempo)\s*:?\s*(\d{2,3})\b|\b(\d{2,3})\s*bpm\b/i;
const CC_LICENSE_PATTERN = /Creative\s+Commons\s+[^<\n\r]+|CC\s+BY(?:-[A-Z]+)?(?:\s+\d(?:\.\d)?)?/i;
const UPLOAD_ID_FROM_URL_PATTERN = /\/files\/[^/?#]+\/(\d+)/i;
// ccMixter upload pages never link real audio/archive files with a static, extension-terminated
// href: the "Download (N files)" action (class="download_hook") is a javascript:// stub that a
// follow-up AJAX call resolves client-side, so it can't be discovered by parsing the fetched page
// text alone. Falling back to ccMixter's own file-listing API (the same data source that download
// action itself resolves through) is the only reliable way to discover those candidates from a
// server-side HTML fetch.
const MIN_STATIC_FILE_CANDIDATES_BEFORE_SKIPPING_DOWNLOAD_ACTION_LOOKUP = 2;
const DOWNLOAD_ACTION_FILE_NOTE = "File candidate was resolved from this upload page's ccMixter download action.";
const NO_VISIBLE_FILE_CANDIDATES_WARNING = 'HTML enrichment did not find visible downloadable file candidates.';

export class CcmixterHtmlClient {
  private readonly fetchImpl: typeof fetch;
  private readonly jsonFetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CcmixterHtmlClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.jsonFetchImpl = options.jsonFetchImpl ?? this.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async enrichUploadPage(sourceUrl: string): Promise<CcmixterHtmlEnrichment> {
    const html = await this.fetchHtml(sourceUrl, 'ccMixter HTML upload page request');
    const enrichment = parseCcmixterUploadHtml(html, sourceUrl);
    return this.resolveDownloadActionFileCandidates(enrichment, sourceUrl);
  }

  async resolveArtistCatalogPage(sourceUrl: string, artistLogin: string): Promise<CcmixterHtmlCatalogResult> {
    const html = await this.fetchHtml(sourceUrl, 'ccMixter HTML artist catalog request');
    return parseCcmixterArtistCatalogHtml(html, sourceUrl, artistLogin);
  }

  private async fetchHtml(sourceUrl: string, requestDescription: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(sourceUrl, {
        headers: {
          accept: 'text/html'
        },
        credentials: 'omit',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.text();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${requestDescription} failed for ${sourceUrl}: request timed out after ${this.timeoutMs} ms.`);
      }

      throw new Error(`${requestDescription} failed for ${sourceUrl}: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Best-effort supplement: an upload page whose visible download action didn't yield enough static
  // file candidates gets a follow-up lookup against ccMixter's own file-listing API (the same
  // authoritative source that action resolves through client-side). Any failure here is swallowed so
  // enrichment still returns whatever the static HTML parse already found.
  private async resolveDownloadActionFileCandidates(
    enrichment: CcmixterHtmlEnrichment,
    sourceUrl: string
  ): Promise<CcmixterHtmlEnrichment> {
    if (enrichment.fileCandidates.length >= MIN_STATIC_FILE_CANDIDATES_BEFORE_SKIPPING_DOWNLOAD_ACTION_LOOKUP) {
      return enrichment;
    }

    const uploadId = extractUploadIdFromSourceUrl(sourceUrl);
    if (!uploadId) {
      return enrichment;
    }

    try {
      const url = buildCcmixterQueryUrl({ uploadId, dataview: 'files' });
      const response = await this.fetchJson(url, 'ccMixter download action file lookup');
      const [rawUpload] = parseCcmixterApiResponse(response);

      if (!rawUpload) {
        return enrichment;
      }

      const resolvedFiles = mapRawApiUpload(rawUpload).files;
      if (resolvedFiles.length === 0) {
        return enrichment;
      }

      const resolvedCandidates: HtmlFileCandidate[] = resolvedFiles.map((file) => ({
        label: file.originalFilename,
        file: {
          ...file,
          displayLabel: file.originalFilename,
          warnings: [...file.warnings, DOWNLOAD_ACTION_FILE_NOTE]
        }
      }));

      return {
        ...enrichment,
        fileCandidates: mergeFileCandidatesByFilename(resolvedCandidates, enrichment.fileCandidates),
        warnings: enrichment.warnings.filter((warning) => warning !== NO_VISIBLE_FILE_CANDIDATES_WARNING)
      };
    } catch {
      return enrichment;
    }
  }

  private async fetchJson(url: URL, requestDescription: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.jsonFetchImpl(url.toString(), {
        headers: {
          accept: 'application/json'
        },
        credentials: 'omit',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${requestDescription} failed for ${url.toString()}: request timed out after ${this.timeoutMs} ms.`);
      }

      throw new Error(`${requestDescription} failed for ${url.toString()}: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractUploadIdFromSourceUrl(sourceUrl: string): string | undefined {
  return UPLOAD_ID_FROM_URL_PATTERN.exec(sourceUrl)?.[1];
}

function mergeFileCandidatesByFilename(primary: HtmlFileCandidate[], fallback: HtmlFileCandidate[]): HtmlFileCandidate[] {
  const seen = new Set(primary.map((candidate) => candidate.file.originalFilename.toLowerCase()));
  const remainingFallback = fallback.filter((candidate) => !seen.has(candidate.file.originalFilename.toLowerCase()));

  return [...primary, ...remainingFallback];
}

export function parseCcmixterArtistCatalogHtml(
  html: string,
  sourceUrl = 'https://ccmixter.org',
  artistLogin?: string
): CcmixterHtmlCatalogResult {
  const uploadsById = new Map<string, ReturnType<typeof mapRawApiUpload>>();
  const fileLinkPattern = /<a\b[^>]*href=["']([^"'>]*\/files\/([^"'/?#>]+)\/(\d+)[^"'>]*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = fileLinkPattern.exec(html)) !== null) {
    const href = decodeHtml(match[1] ?? '');
    const linkedArtistLogin = decodeURIComponentSafe(match[2]) ?? match[2] ?? artistLogin;
    const uploadId = match[3];

    if (!uploadId || (artistLogin && linkedArtistLogin && linkedArtistLogin.toLowerCase() !== artistLogin.toLowerCase())) {
      continue;
    }

    if (uploadsById.has(uploadId)) {
      continue;
    }

    const block = extractUploadBlock(html, match.index);
    const title = decodeHtml(stripTags(match[4] ?? '')).trim() || `ccMixter upload ${uploadId}`;
    const artist = parseArtistFromCatalogBlock(block, linkedArtistLogin ?? artistLogin ?? 'unknown_artist');
    const tags = parseTags(block);
    const uploadedAt = parseCatalogDate(block);
    const bpm = parseBpm(block, decodeHtml(stripTags(block))) ?? parseBpmFromTags(tags);
    const licenseSummary = parseCatalogLicense(block);
    const resolvedUrl = resolveUrl(href, sourceUrl);

    uploadsById.set(
      uploadId,
      mapRawApiUpload({
        upload_id: uploadId,
        upload_name: title,
        user_name: artist.login,
        user_real_name: artist.displayName,
        upload_bpm: bpm,
        upload_tags: tags.join(','),
        file_page_url: resolvedUrl,
        upload_date: uploadedAt,
        license_name: licenseSummary
      })
    );
  }

  const nextPageUrls = parseCatalogPageUrls(html, sourceUrl, artistLogin);
  const totalCount = parseCatalogTotalCount(html);
  const mappings = [...uploadsById.values()];
  const warnings =
    mappings.length === 0
      ? ['HTML artist catalog fallback did not find visible upload catalog entries.']
      : ['HTML artist catalog fallback was used for upload discovery.'];

  return {
    mappings,
    nextPageUrls,
    totalCount,
    warnings
  };
}

export function parseCcmixterUploadHtml(html: string, sourceUrl?: string): CcmixterHtmlEnrichment {
  const warnings: string[] = [];
  const cleanedHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const text = decodeHtml(stripTags(cleanedHtml));
  const bpm = parseBpm(cleanedHtml, text);
  const tags = parseTags(cleanedHtml);
  const licenseSummary = parseLicenseSummary(cleanedHtml, text);
  const fileCandidates = parseFileCandidates(html, sourceUrl);
  const zipFileHints = parseZipFileHints(text);
  const relatedUploadUrls = parseRelatedUploadUrls(cleanedHtml, sourceUrl);

  if (typeof bpm !== 'number') {
    warnings.push('HTML enrichment did not find a reliable BPM value.');
  }

  if (tags.length === 0) {
    warnings.push('HTML enrichment did not find visible upload tags.');
  }

  if (!licenseSummary) {
    warnings.push('HTML enrichment did not find visible license summary.');
  }

  if (fileCandidates.length === 0) {
    warnings.push(NO_VISIBLE_FILE_CANDIDATES_WARNING);
  }

  return {
    sourceUrl,
    bpm,
    tags,
    licenseSummary,
    fileCandidates,
    zipFileHints,
    relatedUploadUrls,
    warnings
  };
}

function parseBpm(html: string, text: string): number | undefined {
  const tableMatch = /<th[^>]*>\s*(?:bpm|tempo)\s*<\/th>\s*<td[^>]*>\s*(\d{2,3})\s*<\/td>/i.exec(html);
  const match = tableMatch ?? BPM_PATTERN.exec(text);
  const value = match?.[1] ?? match?.[2];

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBpmFromTags(tags: string[]): number | undefined {
  for (const tag of tags) {
    const rangeMatch = /^bpm_(\d{2,3})_(\d{2,3})$/i.exec(tag);
    if (rangeMatch) {
      const low = Number.parseInt(rangeMatch[1]!, 10);
      const high = Number.parseInt(rangeMatch[2]!, 10);
      if (Number.isFinite(low) && Number.isFinite(high)) {
        return Math.round((low + high) / 2);
      }
    }

    const exactMatch = /^bpm_(\d{2,3})$/i.exec(tag);
    if (exactMatch) {
      const exact = Number.parseInt(exactMatch[1]!, 10);
      if (Number.isFinite(exact)) {
        return exact;
      }
    }
  }

  return undefined;
}

function parseTags(html: string): string[] {
  const tags = new Set<string>();
  const linkPattern = /<a\b[^>]*href=["'][^"'>]*(?:\/tags\/|[?&]tags?=)([^"'&/#?>]+)[^"'>]*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const tagFromHref = decodeURIComponentSafe(match[1]);
    const tagFromText = decodeHtml(stripTags(match[2] ?? ''));
    const tag = cleanTag(tagFromText) || cleanTag(tagFromHref);

    if (tag) {
      tags.add(tag);
    }
  }

  return [...tags];
}

function parseCatalogLicense(html: string): string | undefined {
  const titleMatch = /<a\b[^>]*rel=["']license["'][^>]*title=["']([^"']+)["'][^>]*>/i.exec(html);
  if (titleMatch?.[1]) {
    return decodeHtml(titleMatch[1]).trim();
  }

  return parseLicenseSummary(html, decodeHtml(stripTags(html)));
}

function parseLicenseSummary(html: string, text: string): string | undefined {
  const licenseLink = /<a\b[^>]*href=["']([^"']*creativecommons\.org\/licenses\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(html);

  if (licenseLink) {
    const label = decodeHtml(stripTags(licenseLink[2] ?? '')).trim();
    return label.length > 0 ? label : licenseLink[1];
  }

  const textMatch = CC_LICENSE_PATTERN.exec(text);
  return textMatch?.[0]?.trim();
}

function extractUploadBlock(html: string, linkIndex: number): string {
  const before = html.slice(0, linkIndex);
  const blockStart = Math.max(before.lastIndexOf('<div class="upload"'), before.lastIndexOf("<div class='upload'"));
  const effectiveStart = blockStart >= 0 ? blockStart : linkIndex;
  const after = html.slice(effectiveStart + 1);
  const nextDoubleQuote = after.search(/<div class="upload"\b/i);
  const nextSingleQuote = after.search(/<div class='upload'\b/i);
  const candidates = [nextDoubleQuote, nextSingleQuote].filter((index) => index >= 0);
  const nextBlock = candidates.length > 0 ? Math.min(...candidates) : -1;

  return html.slice(effectiveStart, nextBlock >= 0 ? effectiveStart + 1 + nextBlock : undefined);
}

function parseArtistFromCatalogBlock(block: string, fallbackLogin: string): { login: string; displayName: string } {
  const artistMatch = /<a\b[^>]*href=["'][^"']*\/people\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
  const login = decodeURIComponentSafe(artistMatch?.[1]) ?? fallbackLogin;
  const displayName = decodeHtml(stripTags(artistMatch?.[2] ?? '')).trim() || login;

  return {
    login,
    displayName
  };
}

function parseCatalogDate(block: string): string | undefined {
  const dateMatch = /<div\b[^>]*class=["'][^"']*upload_date[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(block);
  const raw = decodeHtml(stripTags(dateMatch?.[1] ?? '')).replace(/\bRecommends\s*\(\d+\)/i, '').trim();

  return raw.length > 0 ? raw.replace(/\s+/g, ' ') : undefined;
}

export interface CatalogViewingRange {
  visibleStart: number;
  visibleEnd: number;
  totalCount: number;
}

const VIEWING_RANGE_PATTERN = /viewing\s+(\d+)\s+through\s+(\d+)\s+of\s+(\d+)/i;

function normalizeCatalogText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function parseCatalogViewingRange(html: string): CatalogViewingRange | undefined {
  const normalized = normalizeCatalogText(html);
  const match = VIEWING_RANGE_PATTERN.exec(normalized);

  if (!match) {
    return undefined;
  }

  const visibleStart = Number.parseInt(match[1]!, 10);
  const visibleEnd = Number.parseInt(match[2]!, 10);
  const totalCount = Number.parseInt(match[3]!, 10);

  if (![visibleStart, visibleEnd, totalCount].every((value) => Number.isFinite(value))) {
    return undefined;
  }

  return { visibleStart, visibleEnd, totalCount };
}

function parseCatalogTotalCount(html: string): number | undefined {
  return parseCatalogViewingRange(html)?.totalCount;
}

function parseCatalogPageUrls(html: string, sourceUrl: string, artistLogin?: string): string[] {
  const currentOffset = getOffsetParam(sourceUrl) ?? 0;
  const candidates: Array<{ url: string; offset: number }> = [];
  const seen = new Set<string>();
  const pageLinkPattern = /<a\b[^>]*href=["']([^"']*[?&](?:amp;)?(?:offset|paging|page)=[^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pageLinkPattern.exec(html)) !== null) {
    const resolved = resolveUrl(decodeHtml(match[1] ?? ''), sourceUrl);

    if (!resolved || seen.has(resolved) || !isSameArtistCatalogUrl(resolved, sourceUrl, artistLogin)) {
      continue;
    }

    const offset = getOffsetParam(resolved) ?? getPagingParam(resolved);

    if (typeof offset !== 'number' || offset <= currentOffset) {
      continue;
    }

    seen.add(resolved);
    candidates.push({ url: resolved, offset });
  }

  candidates.sort((a, b) => a.offset - b.offset);

  return candidates.map((candidate) => candidate.url);
}

function getOffsetParam(url: string): number | undefined {
  try {
    const offset = new URL(url).searchParams.get('offset');
    if (offset === null) {
      return undefined;
    }
    const parsed = Number.parseInt(offset, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getPagingParam(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const value = parsed.searchParams.get('page') ?? parsed.searchParams.get('paging');
    if (value === null) {
      return undefined;
    }
    const parsedValue = Number.parseInt(value, 10);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  } catch {
    return undefined;
  }
}

function isSameArtistCatalogUrl(url: string, sourceUrl: string, artistLogin?: string): boolean {
  try {
    const parsed = new URL(url);
    const source = new URL(sourceUrl);

    if (parsed.hostname.toLowerCase() !== source.hostname.toLowerCase()) {
      return false;
    }

    if (!artistLogin) {
      return true;
    }

    const loginMatch = /\/(?:people|files)\/([^/?#]+)/i.exec(parsed.pathname);

    if (!loginMatch) {
      return true;
    }

    const pathLogin = decodeURIComponentSafe(loginMatch[1]) ?? loginMatch[1] ?? '';
    return pathLogin.toLowerCase() === artistLogin.toLowerCase();
  } catch {
    return false;
  }
}

function parseFileCandidates(html: string, sourceUrl?: string): HtmlFileCandidate[] {
  const candidates: HtmlFileCandidate[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const href = decodeHtml(match[1] ?? '');
    const label = decodeHtml(stripTags(match[2] ?? '')).trim();
    const filename = filenameFromHref(href, sourceUrl) ?? filenameFromText(label);

    if (!filename || !isFileCandidate(filename, href)) {
      continue;
    }

    const resolvedUrl = resolveUrl(href, sourceUrl);
    const key = `${filename}|${resolvedUrl ?? ''}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push({
      label,
      file: {
        ...buildTrackFile(filename, resolvedUrl, 'html-enriched', [
          'File candidate was extracted from upload-page HTML and has not been verified by the API.'
        ]),
        displayLabel: label
      }
    });
  }

  for (const url of parseScriptAssignedMediaUrls(html)) {
    const filename = filenameFromHref(url, sourceUrl);
    if (!filename || !isFileCandidate(filename, url)) {
      continue;
    }

    const resolvedUrl = resolveUrl(url, sourceUrl);
    const key = `${filename}|${resolvedUrl ?? ''}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push({
      label: filename,
      file: {
        ...buildTrackFile(filename, resolvedUrl, 'html-enriched', [
          'File candidate was extracted from upload-page script data and has not been verified by the API.'
        ]),
        displayLabel: filename
      }
    });
  }

  return candidates;
}

function parseScriptAssignedMediaUrls(html: string): string[] {
  const urls = new Set<string>();
  const scriptUrlPattern = /["'](https?:\/\/ccmixter\.org\/[^"']+\.(?:mp3|flac|wav|aif|aiff|ogg|m4a|zip)(?:[?#][^"']*)?)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptUrlPattern.exec(html)) !== null) {
    if (match[1]) {
      urls.add(decodeHtml(match[1]));
    }
  }

  return [...urls];
}

function parseZipFileHints(text: string): string[] {
  const hints = new Set<string>();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (/\.(?:flac|wav|aif|aiff|mp3|ogg|m4a)\b/i.test(line) || /\bzip\b/i.test(line)) {
      hints.add(line.replace(/\s+/g, ' '));
    }
  }

  return [...hints];
}

function parseRelatedUploadUrls(html: string, sourceUrl?: string): string[] {
  const urls = new Set<string>();
  const sourceAbsolute = sourceUrl ? resolveUrl(sourceUrl) : undefined;
  const linkPattern = /<a\b[^>]*href=["']([^"'>]*\/files\/[^"'>]+\/\d+[^"'>]*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const resolved = resolveUrl(decodeHtml(match[1] ?? ''), sourceUrl);

    if (resolved && resolved !== sourceAbsolute) {
      urls.add(resolved);
    }
  }

  return [...urls];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '\n');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanTag(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^#/, '').replace(/\s+/g, '_').toLowerCase();
  return cleaned && /^[a-z0-9._-]+$/i.test(cleaned) ? cleaned : undefined;
}

function decodeURIComponentSafe(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function filenameFromHref(href: string, sourceUrl?: string): string | undefined {
  const resolved = resolveUrl(href, sourceUrl);

  if (!resolved) {
    return undefined;
  }

  const parsed = new URL(resolved);
  const filename = parsed.pathname.split('/').filter(Boolean).at(-1);
  return filename ? decodeURIComponentSafe(filename) : undefined;
}

function filenameFromText(label: string): string | undefined {
  const match = /[\w .()[\]-]+\.(?:mp3|flac|wav|aif|aiff|ogg|m4a|zip)\b/i.exec(label);
  return match?.[0]?.trim();
}

function isFileCandidate(filename: string, href: string): boolean {
  return FILE_LINK_PATTERN.test(filename) || FILE_LINK_PATTERN.test(href);
}

function resolveUrl(href: string, baseUrl = 'https://ccmixter.org'): string | undefined {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
