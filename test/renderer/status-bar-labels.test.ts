import { describe, expect, it } from 'vitest';

import { resolveStatusBarRootLabel } from '../../src/renderer/ui/catalogStatus';

describe('resolveStatusBarRootLabel', () => {
  it('returns a clear not-set message when no root folder is chosen', () => {
    expect(resolveStatusBarRootLabel(null)).toBe('Stem library not set');
  });

  it('returns the folder path when a root folder is set', () => {
    expect(resolveStatusBarRootLabel({ path: 'D:/Stem Library', selectedAt: '2026-07-03T00:00:00.000Z' })).toBe('D:/Stem Library');
  });
});
