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
  wiederholen: "step_4_repetition",
  mini_check: "step_5_minicheck",
};

export function canonicalStepKey(step: string): string {
  return STEP_KEY_MAP[step] ?? `step_${step}`;
}
