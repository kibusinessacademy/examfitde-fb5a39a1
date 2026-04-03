/**
 * SSOT Step-Key Mapping: German lesson steps → English DB standard
 *
 * This is the SINGLE SOURCE OF TRUTH for step-key mapping.
 * All edge functions MUST import from here instead of defining local copies.
 */

export const STEP_KEY_MAP: Record<string, string> = {
  einstieg: "step_1_introduction",
  verstehen: "step_2_understanding",
  anwenden: "step_3_application",
  reflektieren: "step_4_reflection",
  transfer: "step_5_transfer",
  wiederholen: "step_6_repetition",
  mini_check: "step_7_minicheck",
};

/** Legacy keys written before canonical mapping was enforced */
const LEGACY_MAP: Record<string, string> = {
  step_einstieg: "step_1_introduction",
  step_verstehen: "step_2_understanding",
  step_anwenden: "step_3_application",
  step_wiederholen: "step_6_repetition",
  step_mini_check: "step_7_minicheck",
  // Old numbering compatibility
  step_4_repetition: "step_6_repetition",
  step_5_minicheck: "step_7_minicheck",
};

const CANONICAL_VALUES = new Set(Object.values(STEP_KEY_MAP));

export function canonicalStepKey(step: string): string {
  if (!step) return "";
  // Already canonical → return as-is
  if (CANONICAL_VALUES.has(step)) return step;
  // Legacy step_<german> → canonical
  if (LEGACY_MAP[step]) return LEGACY_MAP[step];
  // German short name → canonical
  if (STEP_KEY_MAP[step]) return STEP_KEY_MAP[step];
  // Unknown step_ prefix → pass through (don't double-prefix)
  if (step.startsWith("step_")) return step;
  // True short token fallback
  return `step_${step}`;
}
