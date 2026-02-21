/**
 * SSOT Error Tag Vocabulary + helpers.
 * Single source for Generator, Rework, and Trap-Retrofit.
 * To add new tags: ONLY edit this file.
 */

export const ERROR_TAG_VOCABULARY = [
  // Calculation-specific
  "netto_brutto",
  "percent_base",
  "skonto_rabatt_order",
  "rounding_units",
  "calculation_error",
  "unit_conversion_error",
  "omission_error",
  "sign_error",
  "order_of_operations",
  "base_value_error",
  "wrong_formula",
  "missing_step",
  // Knowledge / conceptual
  "definition_confusion",
  "recht_frist",
  "prozess_schritt",
  "zustaendigkeit_rolle",
  "dateninterpretation",
  "typical_distractor_plausible_wrong",
] as const;

export type ErrorTag = typeof ERROR_TAG_VOCABULARY[number];

/** Normalize a raw tag string to SSOT format */
export function normalizeTag(t: unknown): string {
  return String(t ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .trim();
}

/** Normalize + filter tags against SSOT vocabulary. Returns deduplicated valid tags only. */
export function filterTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const set = new Set<string>();
  for (const raw of tags) {
    const norm = normalizeTag(raw);
    if ((ERROR_TAG_VOCABULARY as readonly string[]).includes(norm)) set.add(norm);
  }
  return [...set];
}
