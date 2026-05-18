import { describe, it, expect, vi } from 'vitest';
import { getBerufUrl, isValidBerufSlug } from '@/lib/seo';

describe('getBerufUrl slug-guard', () => {
  it('returns /berufe/<slug> for valid canonical slug', () => {
    expect(getBerufUrl('fachinformatiker-systemintegration')).toBe(
      '/berufe/fachinformatiker-systemintegration',
    );
  });

  it('falls back to /berufe for numeric ID-fragment "0-9468"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getBerufUrl('0-9468')).toBe('/berufe');
    warn.mockRestore();
  });

  it('falls back to /berufe for null/empty/undefined', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getBerufUrl(null)).toBe('/berufe');
    expect(getBerufUrl(undefined)).toBe('/berufe');
    expect(getBerufUrl('')).toBe('/berufe');
    warn.mockRestore();
  });

  it('isValidBerufSlug rejects non-canonical inputs', () => {
    expect(isValidBerufSlug('fachinformatiker')).toBe(true);
    expect(isValidBerufSlug('0-9468')).toBe(false);
    expect(isValidBerufSlug('UPPER')).toBe(false);
    expect(isValidBerufSlug('a')).toBe(false);
    expect(isValidBerufSlug(null)).toBe(false);
  });
});
