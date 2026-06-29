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

const ROOT = process.cwd();
const pdpPage = readFileSync(
  resolve(ROOT, 'src/pages/seo/CertificationSEOPage.tsx'),
  'utf8',
);
const heroSection = readFileSync(
  resolve(ROOT, 'src/components/product/ProductHeroSection.tsx'),
  'utf8',
);

describe('PDP.HERO.CLS.STABILIZE.1 — CertificationSEOPage', () => {
  it('reserves H1 height to prevent CLS on hydration', () => {
    expect(pdpPage).toMatch(/min-h-\[120px\][\s\S]{0,400}data-testid="pdp-hero-h1"/);
  });

  it('reserves subline height', () => {
    expect(pdpPage).toMatch(/min-h-\[84px\][\s\S]{0,400}data-testid="pdp-hero-subline"/);
  });

  it('reserves CTA-row height', () => {
    expect(pdpPage).toMatch(/min-h-\[48px\][\s\S]{0,200}data-testid="pdp-hero-cta-row"/);
  });

  it('reserves the conditional notice slot height', () => {
    expect(pdpPage).toMatch(/min-h-\[20px\][\s\S]{0,200}data-testid="pdp-hero-notice"/);
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

describe('PDP.HERO.CLS.STABILIZE.1 — metric-adjusted font fallbacks', () => {
  const indexCss = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');
  const tw = readFileSync(resolve(ROOT, 'tailwind.config.ts'), 'utf8');

  it('declares Inter + Space Grotesk metric-adjusted fallback @font-face', () => {
    expect(indexCss).toMatch(/font-family:\s*'Inter Fallback'/);
    expect(indexCss).toMatch(/font-family:\s*'Space Grotesk Fallback'/);
    expect(indexCss).toMatch(/size-adjust:/);
    expect(indexCss).toMatch(/ascent-override:/);
  });

  it('wires the fallbacks into Tailwind sans/display stacks before system-ui', () => {
    expect(tw).toMatch(/"Inter",\s*"Inter Fallback",\s*"system-ui"/);
    expect(tw).toMatch(/"Space Grotesk",\s*"Space Grotesk Fallback",\s*"system-ui"/);
  });
});


describe('PDP.HERO.FONT.PRELOAD.1 — self-hosted hero font preload', () => {
  const indexHtml = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const indexCss = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');

  it('preloads Inter latin WOFF2 with crossorigin', () => {
    expect(indexHtml).toMatch(
      /rel="preload"[^>]*href="\/fonts\/inter-latin-var\.woff2"[^>]*as="font"[^>]*type="font\/woff2"[^>]*crossorigin/,
    );
  });

  it('preloads Space Grotesk 700 latin WOFF2 with crossorigin + fetchpriority=high', () => {
    expect(indexHtml).toMatch(
      /rel="preload"[^>]*href="\/fonts\/spacegrotesk-700-latin\.woff2"[^>]*as="font"[^>]*crossorigin[^>]*fetchpriority="high"/,
    );
  });

  it('declares matching @font-face rules with font-display: swap', () => {
    expect(indexCss).toMatch(/url\('\/fonts\/inter-latin-var\.woff2'\)[\s\S]{0,200}font-display:\s*swap/);
    expect(indexCss).toMatch(/url\('\/fonts\/spacegrotesk-700-latin\.woff2'\)/);
    expect(indexCss).toMatch(/font-weight:\s*400 700/);
  });

  it('keeps unicode-range scoped to latin so Google CSS fills other subsets', () => {
    expect(indexCss).toMatch(/unicode-range:\s*U\+0000-00FF/);
    expect(indexCss).toMatch(/U\+0100-02BA/); // latin-ext
  });
});
