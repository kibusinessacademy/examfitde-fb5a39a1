import { describe, it, expect } from 'vitest';
import { resolveBerufAltText, auditBerufAltTexts } from '@/lib/berufAltText';

describe('resolveBerufAltText', () => {
  it('returns the provided alt_text verbatim when present', () => {
    expect(
      resolveBerufAltText({
        altText: 'Fachinformatik-Auszubildende konfiguriert Netzwerktechnik im Serverraum.',
        title: 'Fachinformatiker',
        kammer: 'IHK',
      }),
    ).toBe('Fachinformatik-Auszubildende konfiguriert Netzwerktechnik im Serverraum.');
  });

  it('falls back to the profession title when alt_text is missing/empty', () => {
    expect(resolveBerufAltText({ altText: null, title: 'KFZ-Mechatroniker', kammer: 'HWK' }))
      .toBe('Berufsbild für KFZ-Mechatroniker (HWK) – Auszubildende im realistischen Arbeitsumfeld.');
    expect(resolveBerufAltText({ altText: '   ', title: 'Bäcker' }))
      .toBe('Berufsbild für Bäcker – Auszubildende im realistischen Arbeitsumfeld.');
  });

  it('returns a safe generic fallback when neither alt_text nor title exists', () => {
    expect(resolveBerufAltText({})).toMatch(/Authentisches deutsches Berufsbild/);
    expect(resolveBerufAltText({ altText: '', title: '' })).toMatch(/Authentisches deutsches Berufsbild/);
  });

  it('never returns an empty string', () => {
    for (const input of [
      {},
      { altText: '' },
      { altText: null, title: null, kammer: null },
      { altText: '   ', title: '   ' },
    ]) {
      expect(resolveBerufAltText(input).length).toBeGreaterThan(0);
    }
  });
});

describe('auditBerufAltTexts', () => {
  it('flags missing alt_text and provides an effective fallback', () => {
    const out = auditBerufAltTexts([
      { slug: 'koch', title: 'Koch', kammer: 'IHK', altText: null },
      { slug: 'baecker', title: 'Bäcker', altText: '   ' },
    ]);
    expect(out[0].ok).toBe(false);
    expect(out[0].reason).toBe('missing');
    expect(out[0].effectiveAlt).toContain('Koch');
    expect(out[1].reason).toBe('missing');
  });

  it('flags too-short alt_text', () => {
    const [row] = auditBerufAltTexts([{ slug: 'x', title: 'X', altText: 'Kurz.' }]);
    expect(row.ok).toBe(false);
    expect(row.reason).toBe('too_short');
  });

  it('passes well-formed alt_text', () => {
    const [row] = auditBerufAltTexts([
      {
        slug: 'fi',
        title: 'Fachinformatiker',
        altText: 'Fachinformatik-Auszubildende konfiguriert Netzwerktechnik im Serverraum.',
      },
    ]);
    expect(row.ok).toBe(true);
    expect(row.reason).toBeUndefined();
  });

  it('effectiveAlt is never empty, even for completely empty rows', () => {
    const out = auditBerufAltTexts([{ slug: 'empty' }]);
    expect(out[0].effectiveAlt.length).toBeGreaterThan(0);
  });
});
