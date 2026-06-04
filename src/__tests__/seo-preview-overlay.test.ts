/**
 * SEO Preview Overlay — Unit Tests
 *
 * Verifiziert, dass `snapshotHead`, `evaluate` und `extractTypes` Title,
 * Meta, Canonical, OG-Tags und JSON-LD pro Route korrekt lesen und bewerten.
 * Simuliert reale Head-Strukturen für /, /berufe und /preise via jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { snapshotHead, evaluate, extractTypes } from '@/components/seo/SeoPreviewOverlay';

function setHead(html: string, title = '') {
  document.head.innerHTML = html;
  if (title) document.title = title;
  else document.title = '';
}

const SITE = 'https://berufos.com';

afterEach(() => {
  document.head.innerHTML = '';
  document.title = '';
});

describe('SeoPreviewOverlay — snapshotHead', () => {
  it('liest Title, Meta, Canonical, OG-Tags und JSON-LD von der Homepage', () => {
    setHead(
      `
      <meta name="description" content="ExamFit — Bestehe deine IHK-Prüfung mit Lernkurs, Trainer und KI-Tutor in einem Bundle." />
      <link rel="canonical" href="${SITE}/" />
      <meta property="og:title" content="ExamFit Home" />
      <meta property="og:description" content="Prüfungsvorbereitung mit KI." />
      <meta property="og:url" content="${SITE}/" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'ExamFit',
      })}</script>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: `${SITE}/`,
      })}</script>
    `,
      'ExamFit — Prüfungsvorbereitung mit KI',
    );

    const snap = snapshotHead();
    expect(snap.title).toContain('ExamFit');
    expect(snap.canonical).toBe(`${SITE}/`);
    expect(snap.ogTitle).toBe('ExamFit Home');
    expect(snap.ogType).toBe('website');
    expect(snap.twitterCard).toBe('summary_large_image');
    expect(snap.jsonLd).toHaveLength(2);
    const types = snap.jsonLd.flatMap(extractTypes);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  it('liest BreadcrumbList + ItemList für /berufe', () => {
    setHead(
      `
      <meta name="description" content="Alle 25 IHK-Berufe mit kompletter Prüfungsvorbereitung — Kurskatalog von ExamFit." />
      <link rel="canonical" href="${SITE}/berufe" />
      <meta property="og:title" content="Kurskatalog — Berufe" />
      <meta property="og:url" content="${SITE}/berufe" />
      <meta property="og:type" content="website" />
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'BreadcrumbList',
      })}</script>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'ItemList',
        numberOfItems: 25,
      })}</script>
    `,
      'Kurskatalog — Berufe | ExamFit',
    );

    const snap = snapshotHead();
    expect(snap.canonical).toBe(`${SITE}/berufe`);
    const types = snap.jsonLd.flatMap(extractTypes);
    expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'ItemList']));
  });

  it('liest Product-Schema für /preise', () => {
    setHead(
      `
      <meta name="description" content="ExamFit Komplettpaket: 24,90 EUR einmalig, 12 Monate Zugang, kein Abo. Lernkurs, Trainer und KI-Tutor." />
      <link rel="canonical" href="${SITE}/preise" />
      <meta property="og:title" content="Preise — ExamFit" />
      <meta property="og:url" content="${SITE}/preise" />
      <meta property="og:type" content="product" />
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'ExamFit Komplettpaket',
        offers: { '@type': 'Offer', price: '24.90', priceCurrency: 'EUR' },
      })}</script>
    `,
      'Preise — Komplette Prüfungsvorbereitung für 24,90 € | ExamFit',
    );

    const snap = snapshotHead();
    expect(snap.ogType).toBe('product');
    expect(snap.canonical).toBe(`${SITE}/preise`);
    const types = snap.jsonLd.flatMap(extractTypes);
    expect(types).toContain('Product');
  });
});

describe('SeoPreviewOverlay — evaluate', () => {
  it('bestraft fehlenden Canonical und zu kurzes Title', () => {
    setHead(`<meta name="description" content="kurz" />`, 'X');
    const { rows, score } = evaluate(snapshotHead());
    const byLabel = (l: string) => rows.find((r) => r.label === l)!;
    expect(byLabel('Title').ok).toBe(false);
    expect(byLabel('Meta Description').ok).toBe(false);
    expect(byLabel('Canonical').ok).toBe(false);
    expect(byLabel('JSON-LD').ok).toBe(false);
    expect(score).toBeLessThan(50);
  });

  it('bestraft Title > 70 Zeichen', () => {
    setHead(`<link rel="canonical" href="${SITE}/" />`, 'x'.repeat(80));
    const { rows } = evaluate(snapshotHead());
    expect(rows.find((r) => r.label === 'Title')!.ok).toBe(false);
  });

  it('toleriert Meta-Description-Länge im Zielfenster 50–170', () => {
    setHead(
      `<meta name="description" content="${'a'.repeat(120)}" />
       <link rel="canonical" href="${SITE}/" />
       <meta property="og:title" content="t" />
       <meta property="og:description" content="d" />
       <meta property="og:url" content="${SITE}/" />
       <script type="application/ld+json">${JSON.stringify({ '@type': 'WebSite' })}</script>`,
      'a'.repeat(40),
    );
    const { rows, score } = evaluate(snapshotHead());
    const titleRow = rows.find((r) => r.label === 'Title')!;
    const descRow = rows.find((r) => r.label === 'Meta Description')!;
    const canonRow = rows.find((r) => r.label === 'Canonical')!;
    expect(titleRow.ok).toBe(true);
    expect(descRow.ok).toBe(true);
    expect(canonRow.ok).toBe(true);
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it('Score 100% bei perfektem Head inkl. og:image', () => {
    setHead(
      `<meta name="description" content="${'b'.repeat(120)}" />
       <link rel="canonical" href="${SITE}/preise" />
       <meta property="og:title" content="t" />
       <meta property="og:description" content="d" />
       <meta property="og:image" content="${SITE}/og.jpg" />
       <meta property="og:url" content="${SITE}/preise" />
       <script type="application/ld+json">${JSON.stringify({ '@type': 'Product' })}</script>`,
      'Preise — Komplette Prüfungsvorbereitung für 24,90 €',
    );
    const { score } = evaluate(snapshotHead());
    expect(score).toBe(100);
  });
});

describe('SeoPreviewOverlay — extractTypes', () => {
  it('liest @type als String oder Array, und folgt @graph', () => {
    expect(extractTypes({ '@type': 'Product' })).toEqual(['Product']);
    expect(extractTypes({ '@type': ['Product', 'Offer'] })).toEqual(['Product', 'Offer']);
    expect(
      extractTypes({
        '@graph': [{ '@type': 'Organization' }, { '@type': 'WebSite' }],
      }),
    ).toEqual(['Organization', 'WebSite']);
    expect(extractTypes(null)).toEqual([]);
    expect(extractTypes({ noType: true })).toEqual([]);
  });
});
