import { describe, expect, it, vi } from 'vitest';

import { ARTIST_CATALOG_QUERY_LIMIT } from '../../src/main/services/ccmixter/ccmixterApiClient';
import { ArtistCatalogSessionManager } from '../../src/main/services/ccmixter/artistCatalogSessionManager';
import { buildTrackFile } from '../../src/main/services/ccmixter/ccmixterApiClient';
import type { CcmixterApiUploadMapping } from '../../src/main/services/ccmixter/ccmixterTypes';

function makeMapping(uploadId: string, artistLogin = 'testArtist'): CcmixterApiUploadMapping {
  return {
    upload: {
      uploadId,
      artistName: 'Test Artist',
      artistLogin,
      title: `Test Upload ${uploadId}`,
      tags: ['test'],
      licenseSummary: 'CC BY',
      sourceUrl: `https://ccmixter.org/files/${artistLogin}/${uploadId}`,
      metadataSource: 'api',
      warnings: []
    },
    files: [buildTrackFile(`test-${uploadId}.mp3`, `https://ccmixter.org/download/${uploadId}`, 'api')],
    warnings: []
  };
}

function makePage(ids: string[]): { mappings: CcmixterApiUploadMapping[]; warnings: string[] } {
  return {
    mappings: ids.map((id) => makeMapping(id)),
    warnings: []
  };
}

describe('ArtistCatalogSessionManager', () => {
  it('returns first chunk with totalCount 96 from HTML info', async () => {
    const apiPage = vi.fn().mockResolvedValue(makePage(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']));
    const catalogPage = vi.fn().mockResolvedValue({
      mappings: [],
      nextPageUrls: [],
      totalCount: 96,
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: catalogPage }
    });

    const result = await manager.startSession('7OOP3D', 'https://ccmixter.org/people/7OOP3D');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.loadedCount).toBe(12);
    expect(result.value.totalCount).toBe(96);
    expect(result.value.hasMore).toBe(true);
    expect(result.value.groups).toHaveLength(12);
  });

  it('appends unique rows on load-more', async () => {
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(['1', '2', '3']))
      .mockResolvedValueOnce(makePage(['4', '5', '6']));

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.loadedCount).toBe(3);

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;

    expect(more.value.loadedCount).toBe(6);
    expect(more.value.groups).toHaveLength(6);
  });

  it('does not duplicate rows on overlapping chunks', async () => {
    let callCount = 0;
    const apiPage = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve(makePage(['1', '2', '3']));
      if (callCount === 2) return Promise.resolve(makePage(['2', '3', '4']));
      return Promise.resolve({ mappings: [], warnings: [] });
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.loadedCount).toBe(3);

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;

    expect(more.value.loadedCount).toBe(4);
    expect(more.value.groups).toHaveLength(4);

    const groupIds = new Set(more.value.groups.map((g) => g.groupId));
    expect(groupIds.size).toBe(4);
  });

  it('prevents concurrent load-more storm', async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const apiPage = vi.fn().mockImplementation(async () => {
      concurrentCalls += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCalls -= 1;
      return makePage(['4', '5', '6']);
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const first = manager.loadMore(start.value.sessionId);
    const second = manager.loadMore(start.value.sessionId);
    const third = manager.loadMore(start.value.sessionId);

    const results = await Promise.all([first, second, third]);

    const okResults = results.filter((r) => r.ok);
    const skippedResults = results.filter((r) => !r.ok);
    expect(okResults.length).toBeGreaterThanOrEqual(1);
    expect(maxConcurrent).toBeLessThanOrEqual(1);
  });

  it('reaches end state when loadedCount reaches totalCount', async () => {
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(['1', '2', '3']))
      .mockResolvedValueOnce(makePage(['4', '5', '6']))
      .mockResolvedValueOnce(makePage(['7', '8']));

    const catalogPage = vi.fn().mockResolvedValue({
      mappings: [],
      nextPageUrls: [],
      totalCount: 8,
      warnings: []
    });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      },
      htmlClient: { resolveArtistCatalogPage: catalogPage }
    });

    const start = await manager.startSession('testArtist', 'https://ccmixter.org/people/testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.value.totalCount).toBe(8);

    const more1 = await manager.loadMore(start.value.sessionId);
    expect(more1.ok).toBe(true);
    if (!more1.ok) return;
    expect(more1.value.loadedCount).toBe(6);
    expect(more1.value.hasMore).toBe(true);

    const more2 = await manager.loadMore(start.value.sessionId);
    expect(more2.ok).toBe(true);
    if (!more2.ok) return;
    expect(more2.value.loadedCount).toBe(8);
    expect(more2.value.hasMore).toBe(false);
  });

  it('stops when no records returned', async () => {
    const apiPage = vi.fn()
      .mockResolvedValueOnce(makePage(['1', '2', '3']))
      .mockResolvedValueOnce({ mappings: [], warnings: [] });

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const more = await manager.loadMore(start.value.sessionId);
    expect(more.ok).toBe(true);
    if (!more.ok) return;
    expect(more.value.loadedCount).toBe(3);
    expect(more.value.hasMore).toBe(false);
  });

  it('returns error for invalid session id', async () => {
    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: async () => ({ mappings: [], warnings: [] }),
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const result = await manager.loadMore('nonexistent-session');
    expect(result.ok).toBe(false);
  });

  it('stops at max page guard', async () => {
    const pageWithOneItem = makePage(['1']);
    const apiPage = vi.fn().mockResolvedValue(pageWithOneItem);

    const manager = new ArtistCatalogSessionManager({
      apiClient: {
        resolveByArtistLoginPage: apiPage,
        resolveByArtistLogin: async () => ({ mappings: [], pagingIncomplete: false, warnings: [] })
      }
    });

    const start = await manager.startSession('testArtist');
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    let sessionId = start.value.sessionId;
    let iterations = 0;
    const maxIterations = 25;

    for (let i = 0; i < maxIterations; i++) {
      const more = await manager.loadMore(sessionId);
      expect(more.ok).toBe(true);
      if (!more.ok) break;
      sessionId = more.value.sessionId;
      iterations += 1;
      if (!more.value.hasMore) break;
    }

    expect(iterations).toBeGreaterThan(0);
    expect(iterations).toBeLessThanOrEqual(20);
  });
});
