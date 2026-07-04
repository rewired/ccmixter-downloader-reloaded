import {
  ARTIST_CATALOG_NO_STEM_EVIDENCE_WARNING,
  ARTIST_SCAN_PAGINATION_WARNING,
  ARTIST_SCAN_REALITY_CHECK_WARNING,
  RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING,
  type ArtistCatalogPageResult,
  type ArtistCatalogState,
  type StemGroup
} from '../../../shared/domain';
import { groupStemUploads } from '../grouping/stemGrouper';
import type { GroupingUploadCandidate } from '../grouping/groupingTypes';
import { ARTIST_CATALOG_QUERY_LIMIT, describeArtistCatalogApiFailure } from './ccmixterApiClient';
import type {
  CcmixterApiUploadMapping,
  CcmixterArtistCatalogPage,
  CcmixterHtmlCatalogResult
} from './ccmixterTypes';

const EVIDENCE_TAG_HINTS = new Set([
  'stem', 'stems', 'source', 'sources', 'pells', 'acapella',
  'a_cappella', 'instrumental', 'flac', 'wav', 'aif', 'aiff',
  'zip', 'archive', 'multiple_formats'
]);
const EVIDENCE_FILENAME_PATTERN = /\b(stems?|sources?|pells?|acapp?ella|instrumental stems?|zip)\b/i;
const MISSING_BPM_WARNING = 'BPM missing for one or more uploads.';
// A duplicate-only or empty API page does not necessarily mean the catalog is exhausted: ccMixter's
// offset paging can skip or repeat a window (e.g. due to concurrent uploads shifting the ordering).
// When a known totalCount says more uploads remain, retry a bounded number of times by nudging the
// offset forward before concluding the source is genuinely unable to make progress.
const MAX_RECOVERY_ATTEMPTS = 3;
// The single-shot resolver's ARTIST_CATALOG_MAX_PAGES (20 pages = 240 uploads at the current
// per-page limit) is a fine safety cap for a one-shot resolve, but it silently truncated real
// scroll-and-load catalogs (e.g. a 553-upload artist stopped dead at 240/553). A user-driven lazy
// load session gets a much higher ceiling so it can actually reach large totalCounts; this remains
// a hard stop only to guard against a runaway/broken pagination source, not an expected catalog size.
const ARTIST_CATALOG_SESSION_MAX_PAGES = 500;

interface InternalSession {
  sessionId: string;
  artistLogin: string;
  sourceUrl: string;
  sourceKind: 'api' | 'html';
  nextOffset: number;
  nextPageUrl?: string;
  seenUploadIds: Set<string>;
  loadedGroups: StemGroup[];
  totalCount?: number;
  hasMore: boolean;
  pageCount: number;
  pagingIncomplete: boolean;
  isLoadingMore: boolean;
  sessionWarnings: string[];
  consecutiveDuplicatePages: number;
  consecutiveEmptyPages: number;
}

export class ArtistCatalogSessionManager {
  private sessions = new Map<string, InternalSession>();
  private apiClient: {
    resolveByArtistLoginPage(artistLogin: string, offset: number): Promise<CcmixterArtistCatalogPage>;
    resolveByArtistLogin(artistLogin: string): Promise<{ mappings: CcmixterApiUploadMapping[]; pagingIncomplete: boolean; warnings: string[] }>;
  };
  private htmlClient?: {
    resolveArtistCatalogPage(sourceUrl: string, artistLogin: string): Promise<{
      mappings: CcmixterApiUploadMapping[];
      nextPageUrls: string[];
      totalCount?: number;
      warnings: string[];
    }>;
  };

  constructor(dependencies: {
    apiClient: {
      resolveByArtistLoginPage(artistLogin: string, offset: number): Promise<CcmixterArtistCatalogPage>;
      resolveByArtistLogin(artistLogin: string): Promise<{ mappings: CcmixterApiUploadMapping[]; pagingIncomplete: boolean; warnings: string[] }>;
    };
    htmlClient?: {
      resolveArtistCatalogPage(sourceUrl: string, artistLogin: string): Promise<{
        mappings: CcmixterApiUploadMapping[];
        nextPageUrls: string[];
        totalCount?: number;
        warnings: string[];
      }>;
    };
  }) {
    this.apiClient = dependencies.apiClient;
    this.htmlClient = dependencies.htmlClient;
  }

  async startSession(
    artistLogin: string,
    sourceUrl?: string,
    normalizedArtistLogin?: string
  ): Promise<{ ok: true; value: ArtistCatalogState } | { ok: false; error: string }> {
    const sessionId = `catalog-${artistLogin}-${Date.now()}`;

    try {
      const guessedSourceUrl = sourceUrl ?? `https://ccmixter.org/people/${encodeURIComponent(artistLogin)}`;

      // Kick off the HTML fallback fetch and the API call at the same time instead of trying the
      // API first and only falling back to HTML once it fails or times out. ccMixter's catalog API
      // can hang for several seconds while the HTML catalog page is typically fast — racing them
      // means a fast HTML response lets the session start immediately without ever waiting out the
      // API's timeout, instead of always paying both costs one after another.
      type ApiOutcome = { ok: true; page: CcmixterArtistCatalogPage } | { ok: false; error: unknown };

      const apiPromise: Promise<ApiOutcome> = this.apiClient
        .resolveByArtistLoginPage(artistLogin, 0)
        .then((page): ApiOutcome => ({ ok: true, page }), (error): ApiOutcome => ({ ok: false, error }));

      let htmlPromise: Promise<CcmixterHtmlCatalogResult | undefined> | undefined = this.htmlClient?.resolveArtistCatalogPage
        ? this.htmlClient.resolveArtistCatalogPage(guessedSourceUrl, artistLogin).catch(() => undefined)
        : undefined;

      let effectiveLogin = artistLogin;
      let firstPage: CcmixterArtistCatalogPage = { mappings: [], warnings: [] };
      let apiFailureWarning: string | undefined;
      let apiSucceeded = false;
      let apiOutcomeKnown = false;
      let totalCount: number | undefined;
      let htmlUsed = false;
      let sourceKind: 'api' | 'html' = 'api';
      let nextPageUrl: string | undefined;
      const sessionWarnings: string[] = [];

      if (htmlPromise) {
        const winner = await Promise.race([
          apiPromise.then((outcome) => ({ from: 'api' as const, outcome })),
          htmlPromise.then((result) => ({ from: 'html' as const, result }))
        ]);

        if (winner.from === 'html' && winner.result && winner.result.mappings.length > 0) {
          firstPage = { mappings: winner.result.mappings, warnings: [] };
          totalCount = winner.result.totalCount;
          nextPageUrl = winner.result.nextPageUrls[0];
          htmlUsed = true;
          sourceKind = 'html';
          sessionWarnings.push(
            `HTML artist catalog fallback succeeded for ${guessedSourceUrl} with ${winner.result.mappings.length} upload(s).`
          );
        } else if (winner.from === 'api') {
          apiOutcomeKnown = true;
          if (winner.outcome.ok) {
            apiSucceeded = true;
            firstPage = winner.outcome.page;
          } else {
            apiFailureWarning = describeArtistCatalogApiFailure(artistLogin, winner.outcome.error);
          }
        }
        // Otherwise HTML won the race but had no usable data (yet) — fall through below and
        // resolve the API outcome (already in flight) the normal way.
      }

      if (!htmlUsed && !apiOutcomeKnown) {
        const apiOutcome = await apiPromise;
        if (apiOutcome.ok) {
          apiSucceeded = true;
          firstPage = apiOutcome.page;
        } else {
          apiFailureWarning = describeArtistCatalogApiFailure(artistLogin, apiOutcome.error);
        }
      }

      if (!htmlUsed && apiSucceeded && firstPage.mappings.length === 0 && normalizedArtistLogin && normalizedArtistLogin !== artistLogin) {
        try {
          firstPage = await this.apiClient.resolveByArtistLoginPage(normalizedArtistLogin, 0);
          effectiveLogin = normalizedArtistLogin;
        } catch (error) {
          apiFailureWarning = describeArtistCatalogApiFailure(artistLogin, error);
        }
      }

      const effectiveSourceUrl = sourceUrl ?? `https://ccmixter.org/people/${encodeURIComponent(effectiveLogin)}`;

      // The normalized-login retry above can change which artist/URL we actually need; if so, the
      // speculative HTML fetch (started for the original login) is no longer valid and must be redone.
      if (!htmlUsed && effectiveSourceUrl !== guessedSourceUrl && this.htmlClient?.resolveArtistCatalogPage) {
        htmlPromise = this.htmlClient.resolveArtistCatalogPage(effectiveSourceUrl, effectiveLogin).catch(() => undefined);
      }

      if (!htmlUsed && (!apiSucceeded || firstPage.mappings.length <= 1) && htmlPromise) {
        const htmlResult = await htmlPromise;
        if (htmlResult && htmlResult.mappings.length > 0) {
          const merged = mergeMappingsByUploadId([...firstPage.mappings, ...htmlResult.mappings]);
          firstPage = { mappings: merged, warnings: firstPage.warnings };
          totalCount = htmlResult.totalCount;
          nextPageUrl = htmlResult.nextPageUrls[0];
          htmlUsed = true;
          sourceKind = 'html';
          sessionWarnings.push(
            `HTML artist catalog fallback succeeded for ${effectiveSourceUrl} with ${htmlResult.mappings.length} upload(s).`
          );
        }
      }

      if (apiFailureWarning) {
        sessionWarnings.unshift(apiFailureWarning);
      }

      if (firstPage.mappings.length === 0) {
        return { ok: false, error: apiFailureWarning ?? 'Artist catalog returned no uploads.' };
      }

      if (typeof totalCount === 'undefined' && !htmlUsed && htmlPromise) {
        const infoPage = await htmlPromise;
        if (infoPage) {
          totalCount = infoPage.totalCount;
        }
      }

      const seenUploadIds = new Set(firstPage.mappings.map((m) => m.upload.uploadId));
      const groups = this.mappingsToGroups(firstPage.mappings, effectiveLogin);
      const hasMore = computeHasMore(seenUploadIds.size, totalCount, sourceKind, nextPageUrl, firstPage.mappings.length > 0);

      const session: InternalSession = {
        sessionId,
        artistLogin: effectiveLogin,
        sourceUrl: effectiveSourceUrl,
        sourceKind,
        nextOffset: firstPage.mappings.length,
        nextPageUrl,
        seenUploadIds,
        loadedGroups: groups,
        totalCount,
        hasMore,
        pageCount: 1,
        pagingIncomplete: false,
        isLoadingMore: false,
        sessionWarnings,
        consecutiveDuplicatePages: 0,
        consecutiveEmptyPages: 0
      };

      this.sessions.set(sessionId, session);

      return {
        ok: true,
        value: sessionToState(session)
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Artist catalog session start failed.'
      };
    }
  }

  async loadMore(sessionId: string): Promise<{ ok: true; value: ArtistCatalogPageResult } | { ok: false; error: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Catalog session ${sessionId} not found.` };
    }

    if (!session.hasMore) {
      return {
        ok: true,
        value: sessionToPageResult(session)
      };
    }

    if (session.isLoadingMore) {
      return {
        ok: true,
        value: sessionToPageResult(session)
      };
    }

    if (session.pageCount >= ARTIST_CATALOG_SESSION_MAX_PAGES) {
      session.pagingIncomplete = true;
      session.hasMore = false;
      return {
        ok: true,
        value: sessionToPageResult(session)
      };
    }

    session.isLoadingMore = true;

    try {
      let newMappings: CcmixterApiUploadMapping[] = [];

      if (session.sourceKind === 'api') {
        const outcome = await this.loadMoreFromApiWithRecovery(session);
        newMappings = outcome.mappings;

        if (outcome.recoveryFailed) {
          session.pagingIncomplete = true;
        }
      } else {
        if (!session.nextPageUrl || !this.htmlClient?.resolveArtistCatalogPage) {
          if (isKnownIncomplete(session)) {
            const outcome = await this.switchToApiAndRecover(session);
            newMappings = outcome.mappings;
            if (outcome.recoveryFailed) {
              session.pagingIncomplete = true;
            }
          } else {
            session.hasMore = false;
            session.isLoadingMore = false;
            return {
              ok: true,
              value: sessionToPageResult(session)
            };
          }
        } else {
          const htmlPage: CcmixterHtmlCatalogResult = await this.htmlClient.resolveArtistCatalogPage(
            session.nextPageUrl,
            session.artistLogin
          );

          newMappings = htmlPage.mappings.filter((m) => !session.seenUploadIds.has(m.upload.uploadId));

          if (typeof htmlPage.totalCount === 'number') {
            session.totalCount = htmlPage.totalCount;
          }

          session.nextPageUrl = htmlPage.nextPageUrls[0];

          if (newMappings.length === 0) {
            session.consecutiveDuplicatePages += 1;

            if (!isKnownIncomplete(session)) {
              session.hasMore = false;
              session.isLoadingMore = false;
              return {
                ok: true,
                value: sessionToPageResult(session)
              };
            }

            if (session.consecutiveDuplicatePages > MAX_RECOVERY_ATTEMPTS) {
              session.pagingIncomplete = true;
              session.hasMore = false;
              session.isLoadingMore = false;
              return {
                ok: true,
                value: sessionToPageResult(session)
              };
            }
            // Leave hasMore as-is so the next scroll-triggered load-more retries (either the same
            // HTML next link again, or drops through to the API-switch branch above once the HTML
            // link disappears) before giving up and marking the session incomplete.
            session.isLoadingMore = false;
            return {
              ok: true,
              value: sessionToPageResult(session)
            };
          } else {
            session.consecutiveDuplicatePages = 0;
          }
        }
      }

      if (newMappings.length === 0) {
        session.hasMore = false;
        session.isLoadingMore = false;
        return {
          ok: true,
          value: sessionToPageResult(session)
        };
      }

      for (const mapping of newMappings) {
        session.seenUploadIds.add(mapping.upload.uploadId);
      }

      const newGroups = this.mappingsToGroups(newMappings, session.artistLogin);
      session.loadedGroups = [...session.loadedGroups, ...newGroups];
      session.pageCount += 1;
      session.hasMore = computeHasMore(
        session.seenUploadIds.size,
        session.totalCount,
        session.sourceKind,
        session.nextPageUrl,
        true
      );

      session.isLoadingMore = false;

      return {
        ok: true,
        value: sessionToPageResult(session)
      };
    } catch (error) {
      session.isLoadingMore = false;
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Catalog load-more failed.'
      };
    }
  }

  // Fetches API pages starting at session.nextOffset, retrying with an advanced offset (up to
  // MAX_RECOVERY_ATTEMPTS times) when a page comes back empty or duplicate-only while a known
  // totalCount says the catalog is not actually exhausted yet. Returns as soon as a page yields at
  // least one unverified upload, or gives up and reports recoveryFailed once the retry budget runs out.
  private async loadMoreFromApiWithRecovery(
    session: InternalSession
  ): Promise<{ mappings: CcmixterApiUploadMapping[]; recoveryFailed: boolean }> {
    for (let attempt = 0; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
      const page = await this.apiClient.resolveByArtistLoginPage(session.artistLogin, session.nextOffset);

      if (page.mappings.length === 0) {
        session.consecutiveEmptyPages += 1;
        session.consecutiveDuplicatePages = 0;

        if (!isKnownIncomplete(session)) {
          return { mappings: [], recoveryFailed: false };
        }

        if (attempt >= MAX_RECOVERY_ATTEMPTS) {
          return { mappings: [], recoveryFailed: true };
        }

        session.nextOffset += ARTIST_CATALOG_QUERY_LIMIT;
        continue;
      }

      const unique = page.mappings.filter((m) => !session.seenUploadIds.has(m.upload.uploadId));
      session.nextOffset += page.mappings.length;

      if (unique.length > 0) {
        session.consecutiveDuplicatePages = 0;
        session.consecutiveEmptyPages = 0;
        return { mappings: unique, recoveryFailed: false };
      }

      session.consecutiveDuplicatePages += 1;

      if (!isKnownIncomplete(session)) {
        return { mappings: [], recoveryFailed: false };
      }

      if (attempt >= MAX_RECOVERY_ATTEMPTS) {
        return { mappings: [], recoveryFailed: true };
      }
      // Duplicate-only page but totalCount says more remain: retry at the advanced offset.
    }

    return { mappings: [], recoveryFailed: true };
  }

  // Used when HTML paging runs out of an immediate next link (or keeps repeating the same page)
  // while a known totalCount says the catalog isn't actually done. ccMixter's API paging is now the
  // reliable path (see net.request fix), so this switches the session over to API offset paging
  // instead of concluding the catalog is complete just because the HTML source stalled.
  private async switchToApiAndRecover(
    session: InternalSession
  ): Promise<{ mappings: CcmixterApiUploadMapping[]; recoveryFailed: boolean }> {
    session.sourceKind = 'api';
    session.nextOffset = session.seenUploadIds.size;
    return this.loadMoreFromApiWithRecovery(session);
  }

  private mappingsToGroups(mappings: CcmixterApiUploadMapping[], artistLogin: string): StemGroup[] {
    const candidates: GroupingUploadCandidate[] = mappings.map((m) => ({
      upload: m.upload,
      files: m.files
    }));

    const groups = candidates.flatMap((candidate) => {
      const result = groupStemUploads([candidate]);
      const group = result.groups[0];
      if (!group) {
        return [];
      }
      const upload = group.uploads[0];
      return [
        {
          ...group,
          groupId: upload ? `ccmixter-catalog-${upload.artistLogin}-${upload.uploadId}` : group.groupId
        }
      ];
    });

    return groups.map((group) => {
      if (hasExplicitSourceStemArchiveEvidence(group)) {
        return {
          ...group,
          warnings: group.warnings.filter((w) => w !== MISSING_BPM_WARNING),
          unverifiedFields: group.unverifiedFields.filter((f) => f !== 'bpm')
        };
      }
      return {
        ...group,
        confidence: 'low' as const,
        warnings: [
          ...group.warnings.filter((w) => w !== MISSING_BPM_WARNING),
          ARTIST_CATALOG_NO_STEM_EVIDENCE_WARNING
        ].filter((w, i, all) => all.indexOf(w) === i),
        unverifiedFields: group.unverifiedFields.filter((f) => f !== 'bpm')
      };
    });
  }
}

function isKnownIncomplete(session: InternalSession): boolean {
  return typeof session.totalCount === 'number' && session.seenUploadIds.size < session.totalCount;
}

function hasExplicitSourceStemArchiveEvidence(group: StemGroup): boolean {
  return (
    group.uploads.some((upload) => upload.tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, '_')).some((tag) => EVIDENCE_TAG_HINTS.has(tag))) ||
    group.uploads.some((upload) => EVIDENCE_FILENAME_PATTERN.test(upload.title)) ||
    group.files.some((file) => file.fileKind === 'stem' || file.fileKind === 'archive') ||
    group.files.some((file) => ['flac', 'wav', 'aif', 'aiff', 'zip'].includes(file.extension.toLowerCase())) ||
    group.files.some((file) => EVIDENCE_FILENAME_PATTERN.test(file.originalFilename))
  );
}

function computeHasMore(
  loadedCount: number,
  totalCount: number | undefined,
  sourceKind: 'api' | 'html',
  nextPageUrl: string | undefined,
  hasAnyMappings: boolean
): boolean {
  if (!hasAnyMappings) {
    return false;
  }

  if (typeof totalCount === 'number') {
    return loadedCount < totalCount;
  }

  if (sourceKind === 'html') {
    return Boolean(nextPageUrl);
  }

  return true;
}

function mergeMappingsByUploadId(mappings: CcmixterApiUploadMapping[]): CcmixterApiUploadMapping[] {
  const byUploadId = new Map<string, CcmixterApiUploadMapping>();
  for (const mapping of mappings) {
    const existing = byUploadId.get(mapping.upload.uploadId);
    if (!existing || existing.files.length === 0) {
      byUploadId.set(mapping.upload.uploadId, mapping);
    }
  }
  return [...byUploadId.values()];
}

function sessionToState(session: InternalSession): ArtistCatalogState {
  return {
    sessionId: session.sessionId,
    artistLogin: session.artistLogin,
    sourceUrl: session.sourceUrl,
    loadedUploadIds: [...session.seenUploadIds],
    groups: session.loadedGroups,
    loadedCount: session.seenUploadIds.size,
    totalCount: session.totalCount,
    hasMore: session.hasMore,
    isLoadingMore: session.isLoadingMore,
    pagingIncomplete: session.pagingIncomplete,
    warnings: [
      ARTIST_SCAN_REALITY_CHECK_WARNING,
      ...session.sessionWarnings,
      ...(session.pagingIncomplete ? [ARTIST_SCAN_PAGINATION_WARNING] : [])
    ]
  };
}

function sessionToPageResult(session: InternalSession): ArtistCatalogPageResult {
  return {
    sessionId: session.sessionId,
    groups: session.loadedGroups,
    loadedCount: session.seenUploadIds.size,
    totalCount: session.totalCount,
    hasMore: session.hasMore,
    pagingIncomplete: session.pagingIncomplete,
    warnings: [
      ...(session.pagingIncomplete ? [ARTIST_SCAN_PAGINATION_WARNING] : [])
    ]
  };
}
