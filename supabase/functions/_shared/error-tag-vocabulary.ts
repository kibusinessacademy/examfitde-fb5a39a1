/**
 * SSOT Error Tag Vocabulary — used by both question generation and trap-tag retrofit.
 * Any additions must happen HERE, not in individual functions.
 */
export const ERROR_TAG_VOCABULARY = [
  // Calculation-specific
  "netto_brutto", "percent_base", "skonto_rabatt_order", "rounding_units",
  "calculation_error", "unit_conversion_error", "omission_error",
  "sign_error", "order_of_operations", "base_value_error",
  // Knowledge / conceptual
  "definition_confusion", "recht_frist", "prozess_schritt", "zustaendigkeit_rolle",
  "dateninterpretation", "typical_distractor_plausible_wrong",
  // Additional common model outputs
  "missing_step", "wrong_formula", "verwechslung", "zeitraum_fehler",
  "falsche_bezugsgroesse", "grenzwert_fehler",
] as const;

export type ErrorTag = typeof ERROR_TAG_VOCABULARY[number];
