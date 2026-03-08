/**
 * Confidence Council — automated quality score for parsed qualification models.
 *
 * Returns 0–100 based on structural completeness.
 */

export interface ConfidenceInput {
  exam_parts?: unknown[];
  handlungsbereiche?: unknown[];
  competency_areas?: unknown[];
  project_components?: unknown[] | boolean;
  oral_components?: unknown[] | boolean;
  legal_basis?: string | null;
  regulation_reference?: string | null;
  admission_rules?: unknown;
  pass_rules?: unknown;
  title_aliases?: unknown[];
}

export function computeConfidence(parsed: ConfidenceInput): number {
  let score = 0;

  // Core structure
  if (Array.isArray(parsed.exam_parts) && parsed.exam_parts.length > 0) score += 25;
  if (Array.isArray(parsed.handlungsbereiche) && parsed.handlungsbereiche.length > 0) score += 25;
  if (Array.isArray(parsed.competency_areas) && parsed.competency_areas.length > 0) score += 10;

  // Exam components
  const hasProject =
    parsed.project_components === true ||
    (Array.isArray(parsed.project_components) && parsed.project_components.length > 0);
  const hasOral =
    parsed.oral_components === true ||
    (Array.isArray(parsed.oral_components) && parsed.oral_components.length > 0);
  if (hasProject) score += 8;
  if (hasOral) score += 7;

  // Legal foundation
  if (parsed.legal_basis) score += 10;
  if (parsed.regulation_reference) score += 5;

  // Completeness bonus
  if (parsed.admission_rules) score += 5;
  if (parsed.pass_rules) score += 5;

  return Math.min(score, 100);
}
