/**
 * Learning Content Sectioning v1 — pure extractor.
 *
 * Reads structured didactic sections from existing lesson.content JSON without
 * breaking back-compat. Accepts forward-compatible `content.sections.*` shape
 * AND legacy top-level keys. Each section is optional; renderer skips empties.
 *
 * Order is didactically fixed:
 *   1. shortExplanation (Kurz erklärt)
 *   2. keyTakeaway      (Merksatz)
 *   3. example          (Beispiel)
 *   4. counterExample   (Gegenbeispiel / Abgrenzung)
 *   5. examPitfall      (Typische Prüfungsfalle)
 *   6. selfCheck        (Mini-Selbstcheck — statisch, kein AI)
 */

export interface LessonSelfCheck {
  question: string;
  answer?: string;
}

export interface ExtractedSections {
  shortExplanation?: string;
  keyTakeaway?: string;
  example?: string;
  counterExample?: string;
  examPitfall?: string;
  selfCheck?: LessonSelfCheck;
  /** Raw HTML fallback used when no structured section is present. */
  fallbackHtml?: string;
  /** Whether at least one structured section was found. */
  hasStructuredSections: boolean;
}

type Bag = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickString(bag: Bag | undefined, keys: string[]): string | undefined {
  if (!bag) return undefined;
  for (const k of keys) {
    const v = asString(bag[k]);
    if (v) return v;
  }
  return undefined;
}

function pickSelfCheck(bag: Bag | undefined, keys: string[]): LessonSelfCheck | undefined {
  if (!bag) return undefined;
  for (const k of keys) {
    const raw = bag[k];
    if (!raw) continue;
    if (typeof raw === 'string') {
      const q = asString(raw);
      if (q) return { question: q };
    }
    if (typeof raw === 'object') {
      const obj = raw as Bag;
      const q = pickString(obj, ['question', 'q', 'frage', 'prompt']);
      const a = pickString(obj, ['answer', 'a', 'antwort', 'reveal', 'solution']);
      if (q) return { question: q, answer: a };
    }
  }
  return undefined;
}

/** Extract didactic sections from a lesson.content JSON value. */
export function extractLessonSections(content: unknown): ExtractedSections {
  const root = (content && typeof content === 'object' ? (content as Bag) : {}) as Bag;
  const sections = (root.sections && typeof root.sections === 'object'
    ? (root.sections as Bag)
    : undefined);

  const shortExplanation =
    pickString(sections, ['short', 'short_explanation', 'kurz', 'summary']) ??
    pickString(root, ['short_explanation', 'kurz_erklaert', 'summary', 'short', 'kurz']);

  const keyTakeaway =
    pickString(sections, ['takeaway', 'key_takeaway', 'merksatz']) ??
    pickString(root, ['takeaway', 'key_takeaway', 'merksatz']);

  const example =
    pickString(sections, ['example', 'beispiel']) ??
    pickString(root, ['example', 'beispiel']);

  const counterExample =
    pickString(sections, ['counter_example', 'gegenbeispiel', 'abgrenzung']) ??
    pickString(root, ['counter_example', 'gegenbeispiel', 'abgrenzung']);

  const examPitfall =
    pickString(sections, ['exam_pitfall', 'pitfall', 'pruefungsfalle', 'prüfungsfalle']) ??
    pickString(root, ['exam_pitfall', 'pitfall', 'pruefungsfalle', 'prüfungsfalle']);

  const selfCheck =
    pickSelfCheck(sections, ['self_check', 'selfcheck', 'mini_self_check', 'reflexion']) ??
    pickSelfCheck(root, ['self_check', 'selfcheck', 'mini_self_check', 'reflexion']);

  const fallbackHtml = asString(root.html);

  const hasStructuredSections = Boolean(
    shortExplanation || keyTakeaway || example || counterExample || examPitfall || selfCheck,
  );

  return {
    shortExplanation,
    keyTakeaway,
    example,
    counterExample,
    examPitfall,
    selfCheck,
    fallbackHtml,
    hasStructuredSections,
  };
}

/** Fixed didactic order — exported for tests / renderers. */
export const SECTION_ORDER = [
  'shortExplanation',
  'keyTakeaway',
  'example',
  'counterExample',
  'examPitfall',
  'selfCheck',
] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];
