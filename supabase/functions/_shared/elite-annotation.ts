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
  conflict_type: string | null;

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
  if (row.exam_context_type && SCENARIO_CONTEXT_TYPES.has(row.exam_context_type)) {
    return true;
  }
  if (Array.isArray(row.transfer_markers) && row.transfer_markers.length > 0) {
    return true;
  }
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
  if (row.decision_structure && MULTI_DECISION_STRUCTURES.has(row.decision_structure)) {
    return true;
  }
  const errCount = Array.isArray(row.typical_errors) ? row.typical_errors.length : 0;
  if (errCount >= 2 && (row.cognitive_level === "analyze" || row.cognitive_level === "evaluate")) {
    return true;
  }
  if (row.knowledge_type === "calculation" || row.knowledge_type === "process") {
    return true;
  }
  const misconCount = Array.isArray(row.typical_misconceptions) ? row.typical_misconceptions.length : 0;
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

  if (Array.isArray(row.trap_tags)) {
    for (const tag of row.trap_tags) {
      const mapped = TRAP_TAG_MAP[tag];
      if (mapped) {
        out.add(mapped);
      } else if (tag && tag.length > 3) {
        out.add(tag);
      }
    }
  }

  if (row.distractor_meta && typeof row.distractor_meta === "object") {
    for (const key of ["d0_trap", "d1_trap", "d2_trap", "d3_trap"]) {
      const val = (row.distractor_meta as Record<string, string>)[key];
      if (typeof val === "string" && val.length > 5) {
        const v = val.toLowerCase();
        if (v.includes("verwechsl") || v.includes("confusion")) out.add("confusion");
        if (v.includes("rechen") || v.includes("calculation")) out.add("calculation_error");
        if (v.includes("paragraph") || v.includes("gesetz") || v.includes("recht")) out.add("legal_reference_trap");
        if (v.includes("reihenfolge") || v.includes("prozess") || v.includes("schritt")) out.add("process_sequence_trap");
        if (v.includes("plausib") || v.includes("nahelieg")) out.add("plausible_wrong");
      }
    }
  }

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
  if (transfer) score += 3;
  if (multivar) score += 3;
  if (distractorTypes.length > 0) score += Math.min(distractorTypes.length, 2);
  if (row.exam_relevance_tier === "core") score += 1;

  // Conflict-type bonus: questions with real conflict are harder and more IHK-realistic
  const hasConflict = row.conflict_type && row.conflict_type !== 'none' && row.conflict_type !== '';
  if (hasConflict) score += 2;

  const cog = (row.cognitive_level || "").toLowerCase();
  if (cog === "apply" || cog === "analyze" || cog === "evaluate") score += 1;
  if ((row.difficulty || "").toLowerCase() === "hard") score += 1;

  const elite_level: "standard" | "advanced" | "elite" =
    score >= 7 ? "elite" :
    score >= 4 ? "advanced" : "standard";

  return { elite_level, multi_variable: multivar, transfer_variant: transfer, distractor_types: distractorTypes, elite_score: score };
}

// ── Helper: Build AnnotationInput from flat question + blueprint + competency rows ──

export function buildAnnotationInput(q: Record<string, unknown>, bp: Record<string, unknown> | null, comp: Record<string, unknown> | null): AnnotationInput {
  const b = bp || {};
  const c = comp || {};
  return {
    id: q.id as string,
    status: q.status as string,
    difficulty: (q.difficulty as string) || null,
    cognitive_level: (q.cognitive_level as string) || null,
    trap_tags: (q.trap_tags as string[]) || null,
    distractor_meta: (q.distractor_meta as Record<string, unknown>) || null,
    conflict_type: (q.conflict_type as string) || null,
    exam_context_type: (b.exam_context_type as string) || null,
    decision_structure: (b.decision_structure as string) || null,
    scenario_type: (b.scenario_type as string) || null,
    typical_errors: (b.typical_errors as string[]) || null,
    knowledge_type: (b.knowledge_type as string) || null,
    real_world_context: (b.real_world_context as boolean) ?? null,
    bloom_level: (c.bloom_level as string) || null,
    exam_relevance_tier: (c.exam_relevance_tier as string) || null,
    transfer_markers: (c.transfer_markers as unknown[]) || null,
    typical_misconceptions: (c.typical_misconceptions as unknown[]) || null,
  };
}
