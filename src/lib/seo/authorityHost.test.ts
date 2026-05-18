import { describe, it, expect } from 'vitest';
import {
  isSeoAuthorityHost,
  shouldNoindexHost,
  buildCanonicalUrl,
  SEO_CANONICAL_ORIGIN,
} from './authorityHost';

describe('isSeoAuthorityHost', () => {
  it.each([
    ['examfit.de', true],
    ['www.examfit.de', true],
    ['EXAMFIT.DE', true],
    [' examfit.de ', true],
    ['examfitde.lovable.app', false],
    ['id-preview--ad51e8f9.lovable.app', false],
    ['examfit.vercel.app', false],
    ['examfit-git-main.vercel.app', false],
    ['localhost', false],
    ['127.0.0.1', false],
    ['staging.examfit.de', false], // subdomain ≠ authority
    ['examfit.com', false],
    ['', false],
  ])('hostname %s → authority=%s', (host, expected) => {
    expect(isSeoAuthorityHost(host)).toBe(expected);
  });
});

describe('shouldNoindexHost', () => {
  it('is the inverse of isSeoAuthorityHost', () => {
    expect(shouldNoindexHost('examfit.de')).toBe(false);
    expect(shouldNoindexHost('www.examfit.de')).toBe(false);
    expect(shouldNoindexHost('examfitde.lovable.app')).toBe(true);
    expect(shouldNoindexHost('examfit.vercel.app')).toBe(true);
    expect(shouldNoindexHost('localhost')).toBe(true);
  });
});

describe('buildCanonicalUrl', () => {
  it('always uses the apex origin', () => {
    expect(buildCanonicalUrl('/aevo-pruefung')).toBe(`${SEO_CANONICAL_ORIGIN}/aevo-pruefung`);
  });

  it('normalises root path', () => {
    expect(buildCanonicalUrl('/')).toBe(`${SEO_CANONICAL_ORIGIN}/`);
    expect(buildCanonicalUrl('')).toBe(`${SEO_CANONICAL_ORIGIN}/`);
  });

  it('removes trailing slash on non-root', () => {
    expect(buildCanonicalUrl('/aevo-pruefung/')).toBe(`${SEO_CANONICAL_ORIGIN}/aevo-pruefung`);
  });

  it('strips all UTM and tracking params by default', () => {
    expect(buildCanonicalUrl('/aevo-pruefung', '?utm_source=google&utm_medium=cpc'))
      .toBe(`${SEO_CANONICAL_ORIGIN}/aevo-pruefung`);
    expect(buildCanonicalUrl('/blog/foo', '?gclid=abc&fbclid=xyz&ef_ref=quiz'))
      .toBe(`${SEO_CANONICAL_ORIGIN}/blog/foo`);
  });

  it('strips fragment-only / empty search', () => {
    expect(buildCanonicalUrl('/x', '')).toBe(`${SEO_CANONICAL_ORIGIN}/x`);
    expect(buildCanonicalUrl('/x', '?')).toBe(`${SEO_CANONICAL_ORIGIN}/x`);
  });

  it('canonical is never a preview host', () => {
    const out = buildCanonicalUrl('/aevo-pruefung');
    expect(out).not.toMatch(/lovable\.app/);
    expect(out).not.toMatch(/vercel\.app/);
    expect(out).not.toMatch(/localhost/);
    expect(out.startsWith('https://examfit.de')).toBe(true);
  });
});
