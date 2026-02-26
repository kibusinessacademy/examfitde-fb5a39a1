/**
 * elite-annotation.ts — SSOT-based Elite Annotation Logic
 *
 * Determines elite_level, multi_variable, transfer_variant, distractor_types
 * purely from structured SSOT fields (blueprint, competency, question metadata).
 * NO text-keyword heuristics. Fully deterministic & reproducible.
 */

// ── Types ──

export interface AnnotationInput {
  id: string;
  status: string;
  difficulty: string | null;
  cognitive_level: string | null;
  trap_tags: string[] | null;
  distractor_meta: Record<string, unknown> | null;

  // Blueprint join fields
  exam_context_type: string | null;
  decision_structure: string | null;
  scenario_type: string | null;
  typical_errors: string[] | null;
  knowledge_type: string | null;
  real_world_context: boolean | null;

  // Competency join fields
  bloom_level: string | null;
  exam_relevance_tier: string | null;
  transfer_markers: unknown[] | null;
  typical_misconceptions: unknown[] | null;
}

export interface EliteAnnotation {
  elite_level: "standard" | "advanced" | "elite";
  multi_variable: boolean;
  transfer_variant: boolean;
  distractor_types: string[];
  elite_score: number;
}

// ── Transfer Detection (SSOT-only) ──

const SCENARIO_CONTEXT_TYPES = new Set([
  "multi_step_case", "applied_case", "error_detection", "legal_evaluation",
]);

export function computeTransfer(row: AnnotationInput): boolean {
  // Signal 1: Blueprint exam_context_type is scenario-based
  if (row.exam_context_type && SCENARIO_CONTEXT_TYPES.has(row.exam_context_type)) {
    return true;
  }

  // Signal 2: Competency has transfer_markers
  if (Array.isArray(row.transfer_markers) && row.transfer_markers.length > 0) {
    return true;
  }

  // Signal 3: High cognitive level + high exam relevance
  const cogHigh = row.cognitive_level === "apply" || row.cognitive_level === "analyze"
    || row.cognitive_level === "evaluate";
  const tierHigh = row.exam_relevance_tier === "core" || row.exam_relevance_tier === "important";

  if (cogHigh && tierHigh && row.real_world_context === true) {
    return true;
  }

  return false;
}

// ── Multi-Variable Detection (SSOT-only) ──

const MULTI_DECISION_STRUCTURES = new Set([
  "multiple_valid_options", "tradeoff_evaluation", "error_detection",
]);

export function computeMultiVariable(row: AnnotationInput): boolean {
  // Signal 1: Blueprint decision_structure implies multiple variables
  if (row.decision_structure && MULTI_DECISION_STRUCTURES.has(row.decision_structure)) {
    return true;
  }

  // Signal 2: Blueprint has multiple typical_errors (complexity proxy)
  const errCount = Array.isArray(row.typical_errors) ? row.typical_errors.length : 0;
  const misconCount = Array.isArray(row.typical_misconceptions) ? row.typical_misconceptions.length : 0;

  if (errCount >= 2 && (row.cognitive_level === "analyze" || row.cognitive_level === "evaluate")) {
    return true;
  }

  // Signal 3: Knowledge type implies multi-step
  if (row.knowledge_type === "calculation" || row.knowledge_type === "process") {
    return true;
  }

  // Signal 4: High misconception density + scenario context
  if (misconCount >= 2 && row.exam_context_type && SCENARIO_CONTEXT_TYPES.has(row.exam_context_type)) {
    return true;
  }

  return false;
}

// ── Distractor Type Mapping (from structured trap_tags + distractor_meta) ──

const TRAP_TAG_MAP: Record<string, string> = {
  "definition_confusion": "confusion",
  "recht_frist": "legal_reference_trap",
  "prozess_schritt": "process_sequence_trap",
  "zustaendigkeit_rolle": "role_responsibility_trap",
  "calculation_error": "calculation_error",
  "omission_error": "omission_trap",
  "typical_distractor_plausible_wrong": "plausible_wrong",
};

export function mapDistractorTypes(row: AnnotationInput): string[] {
  const out = new Set<string>();

  // 1. Direct mapping from structured trap_tags
  if (Array.isArray(row.trap_tags)) {
    for (const tag of row.trap_tags) {
      const mapped = TRAP_TAG_MAP[tag];
      if (mapped) {
        out.add(mapped);
      } else if (tag && tag.length > 3) {
        // Keep unmapped tags as-is (they're already structured)
        out.add(tag);
      }
    }
  }

  // 2. From distractor_meta d0_trap/d1_trap/d2_trap/d3_trap values
  if (row.distractor_meta && typeof row.distractor_meta === "object") {
    for (const key of ["d0_trap", "d1_trap", "d2_trap", "d3_trap"]) {
      const val = (row.distractor_meta as Record<string, string>)[key];
      if (typeof val === "string" && val.length > 5) {
        // Extract category from trap description
        const v = val.toLowerCase();
        if (v.includes("verwechsl") || v.includes("confusion")) out.add("confusion");
        if (v.includes("rechen") || v.includes("calculation")) out.add("calculation_error");
        if (v.includes("paragraph") || v.includes("gesetz") || v.includes("recht")) out.add("legal_reference_trap");
        if (v.includes("reihenfolge") || v.includes("prozess") || v.includes("schritt")) out.add("process_sequence_trap");
        if (v.includes("plausib") || v.includes("nahelieg")) out.add("plausible_wrong");
      }
    }
  }

  // 3. From blueprint typical_errors (structured strings)
  if (Array.isArray(row.typical_errors)) {
    for (const err of row.typical_errors) {
      const s = String(err).toLowerCase();
      if (s.includes("verwechselt") || s.includes("fachbegriff")) out.add("confusion");
      if (s.includes("vorschrift") || s.includes("nicht beachtet")) out.add("legal_reference_trap");
      if (s.includes("priorisiert") || s.includes("reihenfolge")) out.add("process_sequence_trap");
    }
  }

  return [...out];
}

// ── Elite Score & Level ──

export function computeElite(row: AnnotationInput): EliteAnnotation {
  const transfer = computeTransfer(row);
  const multivar = computeMultiVariable(row);
  const distractorTypes = mapDistractorTypes(row);

  let score = 0;

  // Transfer: +3
  if (transfer) score += 3;

  // Multi-variable: +3
  if (multivar) score += 3;

  // Distractor diversity: +2 (if types mapped)
  if (distractorTypes.length > 0) score += Math.min(distractorTypes.length, 2);

  // Exam relevance tier: +1
  if (row.exam_relevance_tier === "core") score += 1;

  // Cognitive level: +1
  const cog = (row.cognitive_level || "").toLowerCase();
  if (cog === "apply" || cog === "analyze" || cog === "evaluate") score += 1;

  // Difficulty: +1
  if ((row.difficulty || "").toLowerCase() === "hard") score += 1;

  // Map to DB enum: standard | advanced | elite
  const elite_level: "standard" | "advanced" | "elite" =
    score >= 7 ? "elite" :
    score >= 4 ? "advanced" : "standard";

  return {
    elite_level,
    multi_variable: multivar,
    transfer_variant: transfer,
    distractor_types: distractorTypes,
    elite_score: score,
  };
}

// ── Batch Query Helper ──
// Returns the SQL-compatible select + join for loading annotation inputs
export const ANNOTATION_SELECT = `
  id, status, difficulty, cognitive_level, trap_tags, distractor_meta,
  question_blueprints!blueprint_id (
    exam_context_type, decision_structure, scenario_type,
    typical_errors, knowledge_type, real_world_context
  ),
  competencies!competency_id (
    bloom_level, exam_relevance_tier, transfer_markers, typical_misconceptions
  )
`;

/** Flatten a joined row into AnnotationInput */
export function toAnnotationInput(row: Record<string, unknown>): AnnotationInput {
  const bp = (row.question_blueprints || {}) as Record<string, unknown>;
  const comp = (row.competencies || {}) as Record<string, unknown>;

  return {
    id: row.id as string,
    status: row.status as string,
    difficulty: (row.difficulty as string) || null,
    cognitive_level: (row.cognitive_level as string) || null,
    trap_tags: (row.trap_tags as string[]) || null,
    distractor_meta: (row.distractor_meta as Record<string, unknown>) || null,

    exam_context_type: (bp.exam_context_type as string) || null,
    decision_structure: (bp.decision_structure as string) || null,
    scenario_type: (bp.scenario_type as string) || null,
    typical_errors: (bp.typical_errors as string[]) || null,
    knowledge_type: (bp.knowledge_type as string) || null,
    real_world_context: (bp.real_world_context as boolean) ?? null,

    bloom_level: (comp.bloom_level as string) || null,
    exam_relevance_tier: (comp.exam_relevance_tier as string) || null,
    transfer_markers: (comp.transfer_markers as unknown[]) || null,
    typical_misconceptions: (comp.typical_misconceptions as unknown[]) || null,
  };
}
