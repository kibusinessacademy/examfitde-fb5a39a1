/**
 * PDP.HERO.CLS.STABILIZE.1 — static guard.
 *
 * Asserts the CertificationSEOPage hero keeps explicit min-h reservations
 * for H1, subline, CTA-row and the conditional notice slot, AND no longer
 * short-circuits to a spinner-only fallback while loading (which caused
 * CLS > 0.1 on /fiae-pruefungsvorbereitung on mobile + desktop).
 *
 * Also asserts ProductHeroSection keeps the explicit width/height that
 * stabilizes the LCP image box on mobile.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pdpPage = readFileSync(
  resolve(__dirname, '../../pages/seo/CertificationSEOPage.tsx'),
  'utf8',
);
const heroSection = readFileSync(
  resolve(__dirname, '../../components/product/ProductHeroSection.tsx'),
  'utf8',
);

describe('PDP.HERO.CLS.STABILIZE.1 — CertificationSEOPage', () => {
  it('reserves H1 height to prevent CLS on hydration', () => {
    expect(pdpPage).toMatch(/data-testid="pdp-hero-h1"[\s\S]{0,400}min-h-\[120px\]/);
  });

  it('reserves subline height', () => {
    expect(pdpPage).toMatch(/data-testid="pdp-hero-subline"[\s\S]{0,400}min-h-\[84px\]/);
  });

  it('reserves CTA-row height', () => {
    expect(pdpPage).toMatch(/data-testid="pdp-hero-cta-row"[\s\S]{0,200}min-h-\[48px\]/);
  });

  it('reserves the conditional notice slot height', () => {
    expect(pdpPage).toMatch(/data-testid="pdp-hero-notice"[\s\S]{0,200}min-h-\[20px\]/);
  });

  it('does not short-circuit to a spinner-only fallback while loading (CLS source)', () => {
    expect(pdpPage).not.toMatch(/if \(isLoading\) \{\s*return \(\s*<div[^>]*>\s*<Loader2/);
  });
});

describe('PDP.HERO.CLS.STABILIZE.1 — ProductHeroSection image stability', () => {
  it('keeps explicit width/height + eager + fetchPriority high on LCP hero image', () => {
    expect(heroSection).toMatch(/loading="eager"/);
    expect(heroSection).toMatch(/fetchPriority="high"/);
    expect(heroSection).toMatch(/width=\{1200\}/);
    expect(heroSection).toMatch(/height=\{900\}/);
  });
});
