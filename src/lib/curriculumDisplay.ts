/**
 * Display-layer SSOT for curriculum names.
 *
 * The DB stores technical titles like "Rahmenlehrplan Bankkaufmann" or
 * "AEVO - Ausbildereignungsprüfung". Learners search for "Bankkaufmann" or
 * "FIAE". This module never mutates the underlying data — it produces a
 * UI-friendly view (display_name, subtitle, category, aliases, popularity)
 * and powers search/filter for the Berufsfinder.
 */

export type CurriculumCategory =
  | 'popular'
  | 'aevo'
  | 'ihk'
  | 'hwk'
  | 'fachwirt'
  | 'meister'
  | 'bachelor_professional'
  | 'fortbildung'
  | 'studium'
  | 'other';

export const CATEGORY_LABEL: Record<CurriculumCategory, string> = {
  popular: '⭐ Beliebt',
  aevo: 'AEVO',
  ihk: 'IHK',
  hwk: 'HWK',
  fachwirt: 'Fachwirte',
  meister: 'Meister',
  bachelor_professional: 'Bachelor Professional',
  fortbildung: 'Fortbildungen',
  studium: 'Studium',
  other: 'Sonstige',
};

export interface CurriculumDisplay {
  id: string;
  raw_title: string;
  display_name: string;
  subtitle?: string;
  category: CurriculumCategory;
  aliases: string[];
  search_blob: string; // lowercased haystack
  popularity: number;  // higher = more prominent
  dedupe_key: string;  // normalized name used to merge duplicates
}

// Curated popular entries (boost score by matching normalized name)
const POPULAR_SEEDS: { match: RegExp; score: number; subtitle?: string }[] = [
  { match: /^aevo$|ausbildereignungspr/i, score: 1000, subtitle: 'IHK-Ausbildereignungsprüfung' },
  { match: /industriekaufmann|industriekauffrau/i, score: 950, subtitle: 'IHK-Abschlussprüfung' },
  { match: /b(ü|u)romanagement/i, score: 920, subtitle: 'Kaufmann/-frau für Büromanagement' },
  { match: /bankkaufmann|bankkauffrau/i, score: 900, subtitle: 'IHK-Abschlussprüfung' },
  { match: /fachinformatiker.*anwendungsentwicklung|^fiae/i, score: 880, subtitle: 'IHK · Anwendungsentwicklung' },
  { match: /fachinformatiker.*systemintegration|^fisi$|^fi[\s-]?si/i, score: 870, subtitle: 'IHK · Systemintegration' },
  { match: /steuerfachangestellte/i, score: 820 },
  { match: /kaufmann.*einzelhandel/i, score: 800 },
  { match: /kaufmann.*gro(ß|ss)|gro(ß|ss)handelsmanagement/i, score: 790 },
  { match: /medizinische.*fachangestellte|^mfa$/i, score: 780 },
  { match: /verwaltungsfachangestellte/i, score: 760 },
  { match: /pflegefachmann|pflegefachfrau/i, score: 740 },
  { match: /elektroniker.*betriebstechnik/i, score: 720 },
  { match: /mechatroniker/i, score: 710 },
];

// Alias dictionary: maps user shortcodes to canonical name fragments
const ALIAS_DICT: Record<string, string[]> = {
  fiae: ['Fachinformatiker', 'Anwendungsentwicklung'],
  fisi: ['Fachinformatiker', 'Systemintegration'],
  'fi-si': ['Fachinformatiker', 'Systemintegration'],
  'fi-ae': ['Fachinformatiker', 'Anwendungsentwicklung'],
  mfa: ['Medizinische Fachangestellte'],
  zfa: ['Zahnmedizinische Fachangestellte'],
  buero: ['Büromanagement'],
  büro: ['Büromanagement'],
  ik: ['Industriekaufmann', 'Industriekauffrau'],
  bk: ['Bankkaufmann', 'Bankkauffrau'],
  ek: ['Einzelhandel'],
};

const RAHMEN_PREFIX = /^\s*rahmenlehrplan\s+/i;
const TRAILING_GENDER = /\s*(?:\/-?in|\(in\)|\/in)\s*$/i;

// AEVO normalisierung: erkennt sowohl "AEVO - Ausbildereignungsprüfung"
// als auch "Ausbildereignungsprüfung (AEVO)" als ein- und denselben Eintrag.
const AEVO_MATCHER = /aevo|ausbildereignung/i;
const AEVO_CANONICAL_DISPLAY = 'AEVO – Ausbildereignungsprüfung';
const AEVO_CANONICAL_KEY = 'aevo';

function stripPrefix(title: string): string {
  return title.replace(RAHMEN_PREFIX, '').trim();
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 -]/gi, '')
    .trim();
}

function classify(name: string): CurriculumCategory {
  const n = name.toLowerCase();
  if (/aevo|ausbildereignung/.test(n)) return 'aevo';
  if (/bachelor professional/.test(n)) return 'bachelor_professional';
  if (/meister(in)?\b/.test(n)) return 'meister';
  if (/fachwirt/.test(n)) return 'fachwirt';
  if (/\bhwk\b|handwerk/.test(n)) return 'hwk';
  if (/\bihk\b|kaufmann|kauffrau|industrie|bank|einzelhandel|büro|verwaltung|steuerfach/.test(n)) return 'ihk';
  if (/studium|bachelor|master|m\.sc|b\.sc/.test(n)) return 'studium';
  if (/betriebswirt|techniker|fortbild/.test(n)) return 'fortbildung';
  return 'other';
}

function deriveAliases(displayName: string): string[] {
  const aliases = new Set<string>();
  const lower = displayName.toLowerCase();
  for (const [alias, frags] of Object.entries(ALIAS_DICT)) {
    if (frags.every((f) => lower.includes(f.toLowerCase()))) aliases.add(alias.toUpperCase());
  }
  // Add gendered variants
  if (/kaufmann\b/i.test(displayName)) aliases.add(displayName.replace(/kaufmann\b/i, 'Kauffrau'));
  if (/kauffrau\b/i.test(displayName)) aliases.add(displayName.replace(/kauffrau\b/i, 'Kaufmann'));
  return [...aliases];
}

function popularityFor(name: string): { score: number; subtitle?: string } {
  for (const seed of POPULAR_SEEDS) {
    if (seed.match.test(name)) return { score: seed.score, subtitle: seed.subtitle };
  }
  return { score: 0 };
}

export function toCurriculumDisplay(raw: { id: string; title: string }): CurriculumDisplay {
  const stripped = stripPrefix(raw.title).replace(TRAILING_GENDER, '').trim();
  const displayName = stripped.length > 0 ? stripped : raw.title;
  const pop = popularityFor(displayName);
  const category = classify(displayName);
  const aliases = deriveAliases(displayName);

  // AEVO-Sonderfall: alle Varianten ("AEVO - Ausbildereignungsprüfung",
  // "Ausbildereignungsprüfung (AEVO)", …) auf einen kanonischen Display-
  // Namen und einen gemeinsamen dedupe_key zusammenführen, damit die
  // Berufsauswahl keine Dubletten zeigt.
  const isAevo = AEVO_MATCHER.test(displayName) || AEVO_MATCHER.test(raw.title);
  const finalDisplay = isAevo ? AEVO_CANONICAL_DISPLAY : displayName;
  const finalAliases = isAevo
    ? [...new Set([...aliases, 'AEVO', 'Ausbildereignungsprüfung', 'Ausbilderschein'])]
    : aliases;
  const dedupe_key = isAevo ? AEVO_CANONICAL_KEY : normalizeKey(displayName);

  const search_blob = [finalDisplay, ...finalAliases, raw.title, CATEGORY_LABEL[category]]
    .join(' ')
    .toLowerCase();
  return {
    id: raw.id,
    raw_title: raw.title,
    display_name: finalDisplay,
    subtitle: pop.subtitle ?? (isAevo ? 'IHK-Ausbildereignungsprüfung' : undefined),
    category: isAevo ? 'aevo' : category,
    aliases: finalAliases,
    search_blob,
    popularity: isAevo ? Math.max(pop.score, 1000) : pop.score,
    dedupe_key,
  };
}

/**
 * Build a deduplicated, ranked display list.
 * Duplicates (same dedupe_key) are merged — highest popularity wins, aliases unioned.
 */
export function buildCurriculumIndex(
  rows: Array<{ id: string; title: string }>,
): CurriculumDisplay[] {
  const byKey = new Map<string, CurriculumDisplay>();
  for (const row of rows) {
    const view = toCurriculumDisplay(row);
    const existing = byKey.get(view.dedupe_key);
    if (!existing) {
      byKey.set(view.dedupe_key, view);
      continue;
    }
    // Merge — prefer entry with higher popularity / shorter (cleaner) raw title
    const keep =
      view.popularity > existing.popularity
        ? view
        : view.popularity === existing.popularity && view.raw_title.length < existing.raw_title.length
          ? view
          : existing;
    const drop = keep === view ? existing : view;
    keep.aliases = [...new Set([...keep.aliases, ...drop.aliases])];
    keep.search_blob = `${keep.search_blob} ${drop.search_blob}`;
    byKey.set(view.dedupe_key, keep);
  }
  return [...byKey.values()].sort(
    (a, b) => b.popularity - a.popularity || a.display_name.localeCompare(b.display_name, 'de'),
  );
}

export type CurriculumSort = 'relevance' | 'az' | 'za' | 'popularity';

export function filterCurricula(
  items: CurriculumDisplay[],
  opts: {
    query?: string;
    category?: CurriculumCategory | 'all';
    recentIds?: string[];
    sort?: CurriculumSort;
  },
): CurriculumDisplay[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const cat = opts.category ?? 'all';
  const sort = opts.sort ?? 'relevance';
  let out = items;
  if (cat === 'popular') {
    out = out.filter((c) => c.popularity > 0);
  } else if (cat !== 'all') {
    out = out.filter((c) => c.category === cat);
  }
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    out = out.filter((c) => tokens.every((tok) => c.search_blob.includes(tok)));
  }
  const byName = (a: CurriculumDisplay, b: CurriculumDisplay) =>
    a.display_name.localeCompare(b.display_name, 'de');
  const byPop = (a: CurriculumDisplay, b: CurriculumDisplay) =>
    b.popularity - a.popularity || byName(a, b);

  if (sort === 'az') {
    out = [...out].sort(byName);
  } else if (sort === 'za') {
    out = [...out].sort((a, b) => byName(b, a));
  } else if (sort === 'popularity') {
    out = [...out].sort(byPop);
  } else if (opts.recentIds?.length) {
    const rank = new Map(opts.recentIds.map((id, i) => [id, i]));
    out = [...out].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.POSITIVE_INFINITY;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return byPop(a, b);
    });
  } else {
    out = [...out].sort(byPop);
  }
  return out;
}

const RECENT_KEY = 'examfit.oral.recent_curricula.v1';
const RECENT_MAX = 5;

export function getRecentCurriculumIds(): string[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(RECENT_KEY) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRecentCurriculum(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const cur = getRecentCurriculumIds().filter((x) => x !== id);
    const next = [id, ...cur].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* noop */ }
}
