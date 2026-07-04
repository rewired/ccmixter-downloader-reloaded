import { buildTrackFile, mapRawApiUpload } from './ccmixterApiClient';
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

export class CcmixterHtmlClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CcmixterHtmlClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async enrichUploadPage(sourceUrl: string): Promise<CcmixterHtmlEnrichment> {
    const html = await this.fetchHtml(sourceUrl, 'ccMixter HTML upload page request');
    return parseCcmixterUploadHtml(html, sourceUrl);
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

  const nextPageUrls = parseCatalogPageUrls(html, sourceUrl);
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
    warnings.push('HTML enrichment did not find visible downloadable file candidates.');
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

function parseCatalogTotalCount(html: string): number | undefined {
  const pattern = /[Vv]iewing\s+\d+\s+through\s+\d+\s+of\s+(\d+)/;
  const match = pattern.exec(html);
  if (match?.[1]) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  const text = decodeHtml(stripTags(html));
  const textMatch = /[Vv]iewing\s+\d+\s+through\s+\d+\s+of\s+(\d+)/.exec(text);
  if (textMatch?.[1]) {
    const parsed = Number.parseInt(textMatch[1], 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseCatalogPageUrls(html: string, sourceUrl: string): string[] {
  const urls = new Set<string>();
  const pageLinkPattern = /<a\b[^>]*href=["']([^"']*(?:[?&]offset=\d+|[?&]paging=)[^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pageLinkPattern.exec(html)) !== null) {
    const resolved = resolveUrl(decodeHtml(match[1] ?? ''), sourceUrl);
    if (resolved) {
      urls.add(resolved);
    }
  }

  return [...urls];
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
