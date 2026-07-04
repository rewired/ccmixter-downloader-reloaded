import { describe, expect, it } from 'vitest';

import { resolveArtistCatalogStatus } from '../../src/renderer/ui/App';

describe('resolveArtistCatalogStatus', () => {
  it('does not claim "All 12 uploads loaded" when totalCount is 96 and hasMore is true', () => {
    const status = resolveArtistCatalogStatus(true, 12, 96, false);

    expect(status).toBe('More uploads available');
    expect(status).not.toContain('All 12 uploads loaded');
  });

  it('reports loading state while a page fetch is in flight, regardless of hasMore', () => {
    expect(resolveArtistCatalogStatus(true, 12, 96, true)).toBe('Loading more uploads…');
    expect(resolveArtistCatalogStatus(false, 12, 96, true)).toBe('Loading more uploads…');
  });

  it('reports the true total once loading has caught up', () => {
    expect(resolveArtistCatalogStatus(false, 96, 96, false)).toBe('All 96 uploads loaded');
  });

  it('falls back to the loaded count when totalCount is unknown and no more pages remain', () => {
    expect(resolveArtistCatalogStatus(false, 12, undefined, false)).toBe('All 12 uploads loaded');
  });

  it('returns no status before any uploads have loaded', () => {
    expect(resolveArtistCatalogStatus(false, 0, undefined, false)).toBeNull();
    expect(resolveArtistCatalogStatus(true, 0, undefined, false)).toBeNull();
  });

  it('never renders "All 240 uploads loaded" when paging stopped incomplete', () => {
    const status = resolveArtistCatalogStatus(false, 240, 553, false, true);

    expect(status).not.toContain('All 240 uploads loaded');
    expect(status).toBe('Catalog incomplete: 240 of 553 loaded');
  });
});
