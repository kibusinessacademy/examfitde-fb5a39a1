import { describe, it, expect } from 'vitest';
import {
  isSeoAuthorityHost,
  shouldNoindexHost,
  buildCanonicalUrl,
  SEO_CANONICAL_ORIGIN,
} from './authorityHost';

describe('isSeoAuthorityHost', () => {
  it.each([
    ['berufos.com', true],
    ['www.berufos.com', true],
    ['BERUFOS.COM', true],
    [' berufos.com ', true],
    ['examfit.de', false], // Legacy redirect domain — no longer authority (Hardcut 2026-05-25)
    ['www.examfit.de', false],
    ['examfitde.lovable.app', false],
    ['id-preview--ad51e8f9.lovable.app', false],
    ['berufos.vercel.app', false],
    ['berufos-git-main.vercel.app', false],
    ['localhost', false],
    ['127.0.0.1', false],
    ['staging.berufos.com', false], // subdomain ≠ authority
    ['berufos.de', false],
    ['', false],
  ])('hostname %s → authority=%s', (host, expected) => {
    expect(isSeoAuthorityHost(host)).toBe(expected);
  });
});

describe('shouldNoindexHost', () => {
  it('is the inverse of isSeoAuthorityHost', () => {
    expect(shouldNoindexHost('berufos.com')).toBe(false);
    expect(shouldNoindexHost('www.berufos.com')).toBe(false);
    expect(shouldNoindexHost('examfit.de')).toBe(true); // legacy → noindex
    expect(shouldNoindexHost('examfitde.lovable.app')).toBe(true);
    expect(shouldNoindexHost('berufos.vercel.app')).toBe(true);
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
    expect(out.startsWith('https://berufos.com')).toBe(true);
  });
});
