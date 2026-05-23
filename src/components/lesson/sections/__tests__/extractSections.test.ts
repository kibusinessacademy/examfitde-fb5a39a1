import { describe, it, expect } from 'vitest';
import { extractLessonSections, SECTION_ORDER } from '../extractSections';

describe('extractLessonSections — Learning Content Sectioning v1', () => {
  it('returns no structured sections for null/empty content', () => {
    expect(extractLessonSections(null).hasStructuredSections).toBe(false);
    expect(extractLessonSections({}).hasStructuredSections).toBe(false);
    expect(extractLessonSections('foo').hasStructuredSections).toBe(false);
  });

  it('keeps html as fallback when no structured sections exist', () => {
    const result = extractLessonSections({ type: 'text', html: '<p>Legacy</p>' });
    expect(result.hasStructuredSections).toBe(false);
    expect(result.fallbackHtml).toBe('<p>Legacy</p>');
  });

  it('reads forward-compatible content.sections.* shape', () => {
    const result = extractLessonSections({
      sections: {
        short: 'Kurzfassung',
        takeaway: 'Merksatz',
        example: 'Beispiel',
        counter_example: 'Abgrenzung',
        exam_pitfall: 'Falle',
        self_check: { question: 'Was ist X?', answer: 'Y' },
      },
    });
    expect(result.hasStructuredSections).toBe(true);
    expect(result.shortExplanation).toBe('Kurzfassung');
    expect(result.keyTakeaway).toBe('Merksatz');
    expect(result.example).toBe('Beispiel');
    expect(result.counterExample).toBe('Abgrenzung');
    expect(result.examPitfall).toBe('Falle');
    expect(result.selfCheck).toEqual({ question: 'Was ist X?', answer: 'Y' });
  });

  it('reads legacy German top-level keys (merksatz, prüfungsfalle, gegenbeispiel)', () => {
    const result = extractLessonSections({
      kurz_erklaert: 'Kurz',
      merksatz: 'Merken',
      beispiel: 'B',
      gegenbeispiel: 'G',
      pruefungsfalle: 'P',
    });
    expect(result.shortExplanation).toBe('Kurz');
    expect(result.keyTakeaway).toBe('Merken');
    expect(result.example).toBe('B');
    expect(result.counterExample).toBe('G');
    expect(result.examPitfall).toBe('P');
    expect(result.hasStructuredSections).toBe(true);
  });

  it('treats whitespace-only strings as empty', () => {
    const result = extractLessonSections({
      sections: { short: '   ', takeaway: 'Real' },
    });
    expect(result.shortExplanation).toBeUndefined();
    expect(result.keyTakeaway).toBe('Real');
  });

  it('accepts self_check as bare string', () => {
    const result = extractLessonSections({
      sections: { self_check: 'Reflektiere kurz: was war neu?' },
    });
    expect(result.selfCheck).toEqual({ question: 'Reflektiere kurz: was war neu?' });
  });

  it('preserves fixed didactic order independent of input key order', () => {
    expect(SECTION_ORDER).toEqual([
      'shortExplanation',
      'keyTakeaway',
      'example',
      'counterExample',
      'examPitfall',
      'selfCheck',
    ]);
  });

  it('combines structured sections with optional html fallback', () => {
    const result = extractLessonSections({
      html: '<p>Voller Text</p>',
      sections: { takeaway: 'Merksatz' },
    });
    expect(result.hasStructuredSections).toBe(true);
    expect(result.keyTakeaway).toBe('Merksatz');
    expect(result.fallbackHtml).toBe('<p>Voller Text</p>');
  });
});
