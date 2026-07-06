import { describe, expect, it } from 'vitest';

import { parseLicenseBadge } from '../../src/renderer/ui/LicenseBadge';

describe('parseLicenseBadge', () => {
  it('maps Attribution (4.0) to a by badge', () => {
    expect(parseLicenseBadge('Attribution (4.0)')).toEqual({ code: 'by', version: '4.0' });
  });

  it('maps Attribution Noncommercial (4.0) to a by-nc badge', () => {
    expect(parseLicenseBadge('Attribution Noncommercial (4.0)')).toEqual({ code: 'by-nc', version: '4.0' });
  });

  it('maps Attribution (3.0) to a by badge', () => {
    expect(parseLicenseBadge('Attribution (3.0)')).toEqual({ code: 'by', version: '3.0' });
  });

  it('maps Attribution Noncommercial (3.0) to a by-nc badge', () => {
    expect(parseLicenseBadge('Attribution Noncommercial (3.0)')).toEqual({ code: 'by-nc', version: '3.0' });
  });

  it('falls back to undefined for license text without a recognized version', () => {
    expect(parseLicenseBadge('Creative Commons Attribution')).toBeUndefined();
    expect(parseLicenseBadge('CC BY')).toBeUndefined();
  });

  it('falls back to undefined for unsupported license variants', () => {
    expect(parseLicenseBadge('Sampling Plus')).toBeUndefined();
    expect(parseLicenseBadge('Attribution ShareAlike (4.0)')).toBeUndefined();
    expect(parseLicenseBadge('Attribution NoDerivs (4.0)')).toBeUndefined();
  });

  it('returns undefined for missing license text', () => {
    expect(parseLicenseBadge(undefined)).toBeUndefined();
  });
});
