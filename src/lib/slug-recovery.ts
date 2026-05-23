/**
 * Slug Recovery v1
 *
 * Pure helper that tries to find a likely catalog slug for a possibly-stale
 * incoming slug from a deep link or older homepage card. Conservative:
 * returns a candidate ONLY when the match is unambiguous, so we never
 * silently redirect users to the wrong course.
 *
 * Strategy (in order):
 *   1) exact match
 *   2) normalize both sides (umlaut-fold, drop /-in/-frau/-/, drop UUID
 *      suffix `-xxxxxxxx`) and exact-match
 *   3) prefix or suffix match against normalized catalog slug, but ONLY
 *      when exactly one candidate matches
 *
 * Never returns a candidate that is identical to the input (that's the
 * caller's job to handle).
 */

const UUID_SUFFIX_RE = /-[0-9a-f]{6,8}(?:[_-]+archived[_-]+[0-9a-f]+)?$/i;
const TRAILING_GENDER_RE = /-(?:frau|innen|in)(?=-|$)/gi;
const SEPARATOR_RE = /[/_]+/g;

function fold(input: string): string {
  return input
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ''); // strip remaining diacritics
}

export function normalizeSlug(slug: string | null | undefined): string {
  if (!slug) return '';
  let s = fold(slug).replace(SEPARATOR_RE, '-');
  s = s.replace(UUID_SUFFIX_RE, '');
  s = s.replace(TRAILING_GENDER_RE, '');
  return s.replace(/--+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Find a single catalog slug that matches the incoming slug.
 * Returns null when there is no match or when the match is ambiguous.
 */
export function findCatalogSlugCandidate(
  incoming: string | null | undefined,
  catalogSlugs: ReadonlyArray<string>,
): string | null {
  if (!incoming || catalogSlugs.length === 0) return null;

  // 1) exact
  if (catalogSlugs.includes(incoming)) return null; // same → caller already loads it

  const normIncoming = normalizeSlug(incoming);
  if (!normIncoming) return null;

  // 2) normalized exact
  const normalized = catalogSlugs.map((s) => ({ slug: s, norm: normalizeSlug(s) }));
  const exact = normalized.filter((n) => n.norm === normIncoming);
  if (exact.length === 1) return exact[0].slug;
  if (exact.length > 1) return null; // ambiguous

  // 3) prefix/suffix match — only when single candidate
  const candidates = normalized.filter(
    (n) =>
      n.norm.startsWith(`${normIncoming}-`) ||
      n.norm.endsWith(`-${normIncoming}`) ||
      n.norm === normIncoming,
  );
  if (candidates.length === 1) return candidates[0].slug;

  return null;
}
