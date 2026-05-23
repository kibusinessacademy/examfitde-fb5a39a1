/**
 * Slug Normalization & Recovery (server-side mirror of src/lib/slug-recovery.ts)
 *
 * Used by create-product-checkout to bridge legacy/folded URL slugs to the
 * canonical DB slug stored on `products.slug` (which may contain umlauts and
 * a `-XXXXXXXX` UUID suffix). Conservative: ambiguous matches fail closed.
 */

const UUID_SUFFIX_RE = /-[0-9a-f]{6,8}(?:[_-]+archived[_-]+[0-9a-f]+)?$/i;
const TRAILING_GENDER_RE = /-(?:frau|innen|in)(?=-|$)/gi;
const SEPARATOR_RE = /[/_]+/g;

export function foldSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Aggressive normalization for fuzzy matching:
 *   - lowercase + trim
 *   - umlauts/diacritics folded
 *   - separators (/ _) → -
 *   - trailing -[6-8 hex] (with optional __archived_… tail) stripped
 *   - trailing -frau / -innen / -in tokens stripped
 *   - duplicate dashes collapsed, leading/trailing dashes removed
 */
export function normalizeSlug(slug: string | null | undefined): string {
  if (!slug) return "";
  let s = foldSlug(slug).replace(SEPARATOR_RE, "-");
  s = s.replace(UUID_SUFFIX_RE, "");
  s = s.replace(TRAILING_GENDER_RE, "");
  return s.replace(/--+/g, "-").replace(/^-|-$/g, "");
}

export type RecoveryStrategy =
  | "exact"
  | "normalized"
  | "uuid_suffix_strip"
  | "prefix"
  | "ambiguous"
  | "miss";

export interface RecoveryResult {
  matched: { id: string; slug: string } | null;
  strategy: RecoveryStrategy;
  candidates: { id: string; slug: string }[];
}

/**
 * Recover a single canonical product row from a possibly-stale slug.
 * Returns `{ matched, strategy, candidates }`.
 *
 *   strategy = exact              → input matches products.slug verbatim
 *   strategy = normalized         → normalize(input) === normalize(db.slug), unique
 *   strategy = uuid_suffix_strip  → db.slug minus -XXXXXXXX matches input verbatim
 *   strategy = prefix             → unique normalized prefix/suffix candidate
 *   strategy = ambiguous          → multiple candidates, fail-closed
 *   strategy = miss               → no candidate
 */
export function recoverProductSlug(
  input: string,
  rows: ReadonlyArray<{ id: string; slug: string }>,
): RecoveryResult {
  if (!input || rows.length === 0) {
    return { matched: null, strategy: "miss", candidates: [] };
  }

  // 1) exact
  const exact = rows.find((r) => r.slug === input);
  if (exact) return { matched: exact, strategy: "exact", candidates: [exact] };

  // 2) UUID-suffix strip (db slug minus suffix matches input verbatim)
  const stripMatches = rows.filter(
    (r) => r.slug.replace(UUID_SUFFIX_RE, "") === input,
  );
  if (stripMatches.length === 1) {
    return {
      matched: stripMatches[0],
      strategy: "uuid_suffix_strip",
      candidates: stripMatches,
    };
  }
  if (stripMatches.length > 1) {
    return { matched: null, strategy: "ambiguous", candidates: stripMatches };
  }

  // 3) normalized equality
  const normInput = normalizeSlug(input);
  if (!normInput) return { matched: null, strategy: "miss", candidates: [] };

  const enriched = rows.map((r) => ({ ...r, norm: normalizeSlug(r.slug) }));
  const normMatches = enriched.filter((r) => r.norm === normInput);
  if (normMatches.length === 1) {
    const m = normMatches[0];
    return { matched: { id: m.id, slug: m.slug }, strategy: "normalized", candidates: normMatches };
  }
  if (normMatches.length > 1) {
    return { matched: null, strategy: "ambiguous", candidates: normMatches };
  }

  // 4) prefix/suffix
  const prefixCands = enriched.filter(
    (r) =>
      r.norm.startsWith(`${normInput}-`) ||
      r.norm.endsWith(`-${normInput}`),
  );
  if (prefixCands.length === 1) {
    const m = prefixCands[0];
    return { matched: { id: m.id, slug: m.slug }, strategy: "prefix", candidates: prefixCands };
  }
  if (prefixCands.length > 1) {
    return { matched: null, strategy: "ambiguous", candidates: prefixCands };
  }

  return { matched: null, strategy: "miss", candidates: [] };
}

/**
 * Best-effort closest-slug suggestion for the *miss* case.
 *
 * Picks the active row whose normalized slug shares the longest prefix with the
 * normalized input, with a soft minimum overlap (≥ 4 chars) to avoid garbage
 * suggestions like "any first product". Returns `null` when nothing meaningful
 * overlaps. Used to power UI fallback redirects (e.g. "Komplettpaket nicht
 * gefunden — meintest du …?").
 */
export function suggestClosestSlug(
  input: string | null | undefined,
  rows: ReadonlyArray<{ id: string; slug: string }>,
): { id: string; slug: string; overlap: number } | null {
  const norm = normalizeSlug(input);
  if (!norm || rows.length === 0) return null;

  let best: { id: string; slug: string; overlap: number } | null = null;
  for (const r of rows) {
    const candNorm = normalizeSlug(r.slug);
    if (!candNorm) continue;
    let i = 0;
    const max = Math.min(norm.length, candNorm.length);
    while (i < max && norm[i] === candNorm[i]) i++;
    // Trim partial-token overlap back to the previous "-" so we don't claim
    // "industriekauf" matches "industriemechaniker".
    let overlap = i;
    while (overlap > 0 && norm[overlap - 1] !== "-" && overlap < norm.length) {
      overlap--;
    }
    if (overlap < 4) continue;
    if (!best || overlap > best.overlap) {
      best = { id: r.id, slug: r.slug, overlap };
    }
  }
  return best;
}

