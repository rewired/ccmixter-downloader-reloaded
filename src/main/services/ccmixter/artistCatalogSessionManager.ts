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
import { ARTIST_CATALOG_MAX_PAGES } from './ccmixterApiClient';
import type {
  CcmixterApiUploadMapping,
  CcmixterArtistCatalogPage
} from './ccmixterTypes';

const EVIDENCE_TAG_HINTS = new Set([
  'stem', 'stems', 'source', 'sources', 'pells', 'acapella',
  'a_cappella', 'instrumental', 'flac', 'wav', 'aif', 'aiff',
  'zip', 'archive', 'multiple_formats'
]);
const EVIDENCE_FILENAME_PATTERN = /\b(stems?|sources?|pells?|acapp?ella|instrumental stems?|zip)\b/i;
const MISSING_BPM_WARNING = 'BPM missing for one or more uploads.';

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
      let firstPage = await this.apiClient.resolveByArtistLoginPage(artistLogin, 0);
      let effectiveLogin = artistLogin;

      if (firstPage.mappings.length === 0 && normalizedArtistLogin && normalizedArtistLogin !== artistLogin) {
        firstPage = await this.apiClient.resolveByArtistLoginPage(normalizedArtistLogin, 0);
        effectiveLogin = normalizedArtistLogin;
      }

      const effectiveSourceUrl = sourceUrl ?? `https://ccmixter.org/people/${encodeURIComponent(effectiveLogin)}`;
      let totalCount: number | undefined;
      let htmlUsed = false;

      if (firstPage.mappings.length <= 1 && this.htmlClient?.resolveArtistCatalogPage) {
        try {
          const htmlResult = await this.htmlClient.resolveArtistCatalogPage(effectiveSourceUrl, effectiveLogin);
          if (htmlResult.mappings.length > 0) {
            const merged = mergeMappingsByUploadId([...firstPage.mappings, ...htmlResult.mappings]);
            firstPage = { mappings: merged, warnings: firstPage.warnings };
            totalCount = htmlResult.totalCount;
            htmlUsed = true;
          }
        } catch {
        }
      }

      if (firstPage.mappings.length === 0) {
        return { ok: false, error: 'Artist catalog returned no uploads.' };
      }

      if (typeof totalCount === 'undefined' && !htmlUsed) {
        try {
          const infoPage = await this.htmlClient?.resolveArtistCatalogPage(effectiveSourceUrl, effectiveLogin);
          if (infoPage) {
            totalCount = infoPage.totalCount;
          }
        } catch {
        }
      }

      const seenUploadIds = new Set(firstPage.mappings.map((m) => m.upload.uploadId));
      const groups = this.mappingsToGroups(firstPage.mappings, effectiveLogin);
      const hasMoreApi = firstPage.mappings.length > 0;
      const hasMore = hasMoreApi && (typeof totalCount !== 'number' || seenUploadIds.size < totalCount);

      const session: InternalSession = {
        sessionId,
        artistLogin: effectiveLogin,
        sourceUrl: effectiveSourceUrl,
        sourceKind: 'api',
        nextOffset: firstPage.mappings.length,
        seenUploadIds,
        loadedGroups: groups,
        totalCount,
        hasMore,
        pageCount: 1,
        pagingIncomplete: false,
        isLoadingMore: false
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

    if (session.pageCount >= ARTIST_CATALOG_MAX_PAGES) {
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
        const page = await this.apiClient.resolveByArtistLoginPage(session.artistLogin, session.nextOffset);

        if (page.mappings.length === 0) {
          session.hasMore = false;
          return {
            ok: true,
            value: sessionToPageResult(session)
          };
        }

        newMappings = page.mappings.filter((m) => !session.seenUploadIds.has(m.upload.uploadId));

        if (newMappings.length === 0) {
          session.hasMore = false;
          return {
            ok: true,
            value: sessionToPageResult(session)
          };
        }

        session.nextOffset += page.mappings.length;
      }

      if (newMappings.length === 0) {
        session.hasMore = false;
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

      if (typeof session.totalCount === 'number' && session.seenUploadIds.size >= session.totalCount) {
        session.hasMore = false;
      }

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

function hasExplicitSourceStemArchiveEvidence(group: StemGroup): boolean {
  return (
    group.uploads.some((upload) => upload.tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, '_')).some((tag) => EVIDENCE_TAG_HINTS.has(tag))) ||
    group.uploads.some((upload) => EVIDENCE_FILENAME_PATTERN.test(upload.title)) ||
    group.files.some((file) => file.fileKind === 'stem' || file.fileKind === 'archive') ||
    group.files.some((file) => ['flac', 'wav', 'aif', 'aiff', 'zip'].includes(file.extension.toLowerCase())) ||
    group.files.some((file) => EVIDENCE_FILENAME_PATTERN.test(file.originalFilename))
  );
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
    warnings: [
      ...(session.pagingIncomplete ? [ARTIST_SCAN_PAGINATION_WARNING] : [])
    ]
  };
}
