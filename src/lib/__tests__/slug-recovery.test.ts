import { describe, it, expect } from 'vitest';
import { findCatalogSlugCandidate, normalizeSlug } from '../slug-recovery';

const CATALOG = [
  'industriekaufmann-frau',
  'bilanzbuchhalter-ihk',
  'fachinformatiker-in-anwendungsentwicklung',
  'fachinformatiker-in-systemintegration',
  'aevo-ausbildereignungspruefung',
  'kaufmann-frau-im-einzelhandel',
  'kaufmann-frau-fuer-bueromanagement',
];

describe('normalizeSlug', () => {
  it('strips umlauts, gendered suffixes, separators', () => {
    expect(normalizeSlug('Fachinformatiker/-in-Anwendungsentwicklung')).toBe(
      'fachinformatiker-anwendungsentwicklung',
    );
    expect(normalizeSlug('industriekaufmann-frau')).toBe('industriekaufmann');
    expect(normalizeSlug('aevo-ausbildereignungsprüfung')).toBe('aevo-ausbildereignungspruefung');
  });

  it('strips uuid suffixes', () => {
    expect(normalizeSlug('industriekaufmann-frau-f5e3403b')).toBe('industriekaufmann');
    expect(normalizeSlug('bilanzbuchhalter-ihk-eef4bbe6__archived_5cb2a784')).toBe(
      'bilanzbuchhalter-ihk',
    );
  });
});

describe('findCatalogSlugCandidate', () => {
  it('returns null on exact match (caller already handles it)', () => {
    expect(findCatalogSlugCandidate('industriekaufmann-frau', CATALOG)).toBeNull();
  });

  it('recovers short slug → catalog slug with gender-suffix', () => {
    expect(findCatalogSlugCandidate('industriekaufmann', CATALOG)).toBe('industriekaufmann-frau');
  });

  it('recovers slug with -in- prefix dropped', () => {
    expect(findCatalogSlugCandidate('fachinformatiker-anwendungsentwicklung', CATALOG)).toBe(
      'fachinformatiker-in-anwendungsentwicklung',
    );
  });

  it('recovers aevo short → full catalog slug', () => {
    expect(findCatalogSlugCandidate('aevo', CATALOG)).toBe('aevo-ausbildereignungspruefung');
  });

  it('recovers kaufmann-im-einzelhandel → kaufmann-frau-im-einzelhandel', () => {
    expect(findCatalogSlugCandidate('kaufmann-im-einzelhandel', CATALOG)).toBe(
      'kaufmann-frau-im-einzelhandel',
    );
  });

  it('returns null when ambiguous (would match multiple)', () => {
    expect(findCatalogSlugCandidate('fachinformatiker', CATALOG)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(findCatalogSlugCandidate('astronaut', CATALOG)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(findCatalogSlugCandidate('', CATALOG)).toBeNull();
    expect(findCatalogSlugCandidate(null, CATALOG)).toBeNull();
  });

  it('returns null on empty catalog', () => {
    expect(findCatalogSlugCandidate('industriekaufmann', [])).toBeNull();
  });

  it('handles uuid-suffixed input', () => {
    expect(findCatalogSlugCandidate('industriekaufmann-frau-f5e3403b', CATALOG)).toBe(
      'industriekaufmann-frau',
    );
  });
});
