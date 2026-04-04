/**
 * Blueprint Fanout — profile-driven blueprint generation for certification competencies.
 *
 * Given a validation_profile, produces blueprint specs per competency with:
 * - knowledge_type + exam_context_type combos
 * - deterministic difficulty distribution (25% easy / 50% medium / 25% hard)
 * - trap type assignment per profile
 * - cognitive level mapping per difficulty
 */

import type { ValidationProfile, BlueprintType } from "./types.ts";

// ── Profile → Blueprint mix ──────────────────────────────────────

type BlueprintSpec = {
  knowledge_type: "concept" | "procedure" | "calculation" | "regulation";
  exam_context_type: string;
  didactic_intent: string;
  decision_structure: string | null;
};

const PROFILE_MIX: Record<string, BlueprintSpec[]> = {
  IHK_AUFSTIEG: [
    { knowledge_type: "concept", exam_context_type: "isolated_knowledge", didactic_intent: "recognition", decision_structure: "single_best_answer" },
    { knowledge_type: "procedure", exam_context_type: "applied_case", didactic_intent: "transfer", decision_structure: "multiple_valid_options" },
  ],
  MEISTER: [
    { knowledge_type: "concept", exam_context_type: "isolated_knowledge", didactic_intent: "recognition", decision_structure: "single_best_answer" },
    { knowledge_type: "procedure", exam_context_type: "applied_case", didactic_intent: "transfer", decision_structure: "multiple_valid_options" },
  ],
  FINANCE: [
    { knowledge_type: "calculation", exam_context_type: "calculation_analysis", didactic_intent: "transfer", decision_structure: "single_best_answer" },
    { knowledge_type: "procedure", exam_context_type: "applied_case", didactic_intent: "transfer", decision_structure: "multiple_valid_options" },
    { knowledge_type: "concept", exam_context_type: "isolated_knowledge", didactic_intent: "recognition", decision_structure: "single_best_answer" },
  ],
  AEVO: [
    { knowledge_type: "procedure", exam_context_type: "case_study", didactic_intent: "diagnose", decision_structure: "risk_assessment" },
    { knowledge_type: "concept", exam_context_type: "applied_case", didactic_intent: "transfer", decision_structure: "multiple_valid_options" },
    { knowledge_type: "regulation", exam_context_type: "legal_evaluation", didactic_intent: "classification", decision_structure: "legal_evaluation" },
  ],
  CERT_TECH: [
    { knowledge_type: "concept", exam_context_type: "model_comparison", didactic_intent: "comparison", decision_structure: "single_best_answer" },
    { knowledge_type: "procedure", exam_context_type: "applied_case", didactic_intent: "transfer", decision_structure: "multiple_valid_options" },
  ],
  SECURITY: [
    { knowledge_type: "concept", exam_context_type: "model_comparison", didactic_intent: "comparison", decision_structure: "single_best_answer" },
    { knowledge_type: "regulation", exam_context_type: "legal_evaluation", didactic_intent: "classification", decision_structure: "risk_assessment" },
    { knowledge_type: "procedure", exam_context_type: "error_detection", didactic_intent: "error_detection", decision_structure: "error_detection" },
  ],
  PRIVACY: [
    { knowledge_type: "regulation", exam_context_type: "legal_evaluation", didactic_intent: "classification", decision_structure: "legal_evaluation" },
    { knowledge_type: "concept", exam_context_type: "applied_case", didactic_intent: "transfer", decision_structure: "single_best_answer" },
  ],
};

// ── Difficulty distribution ──────────────────────────────────────

const DIFFICULTIES: Array<"easy" | "medium" | "hard"> = ["easy", "medium", "hard"];

/** Deterministic difficulty based on competency index within the fanout */
function assignDifficulty(index: number): "easy" | "medium" | "hard" {
  const mod = index % 4;
  if (mod === 0) return "easy";
  if (mod === 3) return "hard";
  return "medium"; // mod 1,2 → medium = 50%
}

// ── Cognitive level per difficulty ────────────────────────────────

function cognitiveLevel(difficulty: string): string {
  switch (difficulty) {
    case "easy": return "remember";
    case "medium": return "understand";
    case "hard": return "apply";
    default: return "understand";
  }
}

// ── Trap type per profile ────────────────────────────────────────

const TRAP_TYPES: Record<string, string[]> = {
  IHK_AUFSTIEG: ["typical_error", "typical_error", "misconception"],
  MEISTER: ["typical_error", "typical_error", "misconception"],
  FINANCE: ["calculation_trap", "calculation_trap", "typical_error"],
  AEVO: ["typical_error", "misconception", "misconception"],
  CERT_TECH: ["misconception", "typical_error", "misconception"],
  SECURITY: ["misconception", "typical_error", "misconception"],
  PRIVACY: ["misconception", "typical_error", "misconception"],
};

function assignTrapType(profile: string, index: number): string {
  const types = TRAP_TYPES[profile] ?? ["typical_error"];
  return types[index % types.length];
}

// ── Exam relevance per blueprint type ────────────────────────────

function examRelevance(spec: BlueprintSpec): "low" | "medium" | "high" {
  if (spec.exam_context_type === "applied_case" || spec.exam_context_type === "case_study" || spec.exam_context_type === "calculation_analysis") return "high";
  if (spec.exam_context_type === "isolated_knowledge") return "medium";
  return "medium";
}

// ── Main fanout function ─────────────────────────────────────────

export type BlueprintRow = {
  curriculum_id: string;
  competency_id: string;
  learning_field_id: string;
  name: string;
  canonical_statement: string;
  knowledge_type: string;
  exam_relevance: string;
  cognitive_level: string;
  didactic_intent: string;
  exam_context_type: string;
  decision_structure: string | null;
  expected_trap_type: string;
  question_template: string;
  scenario_type: string;
  exam_relevance_score: number;
  real_world_context: boolean;
  allowed_question_types: string[];
  status: "draft";
  version: string;
};

export function generateBlueprintRows(input: {
  validationProfile: string;
  curriculumId: string;
  competencies: Array<{
    id: string;
    title: string;
    description?: string;
    learning_field_id: string;
    bloom_level?: string;
    code?: string;
  }>;
}): BlueprintRow[] {
  const profile = input.validationProfile;
  const specs = PROFILE_MIX[profile] ?? PROFILE_MIX["CERT_TECH"];
  const rows: BlueprintRow[] = [];

  let globalIndex = 0;

  for (const comp of input.competencies) {
    for (let si = 0; si < specs.length; si++) {
      const spec = specs[si];
      const difficulty = assignDifficulty(globalIndex);
      const cogLevel = cognitiveLevel(difficulty);
      const trapType = assignTrapType(profile, globalIndex);
      const relevance = examRelevance(spec);

      const name = `${comp.code ?? comp.id.slice(0, 8)} – ${spec.knowledge_type} (${difficulty})`;
      const canonical = comp.description ?? comp.title;

      rows.push({
        curriculum_id: input.curriculumId,
        competency_id: comp.id,
        learning_field_id: comp.learning_field_id,
        name,
        canonical_statement: canonical,
        knowledge_type: spec.knowledge_type,
        exam_relevance: relevance,
        cognitive_level: cogLevel,
        didactic_intent: spec.didactic_intent,
        exam_context_type: spec.exam_context_type,
        decision_structure: spec.decision_structure,
        expected_trap_type: trapType,
        question_template: `{${spec.knowledge_type}_template}`,
        scenario_type: spec.exam_context_type === "isolated_knowledge" ? "single_competency" : "applied_scenario",
        exam_relevance_score: relevance === "high" ? 8 : relevance === "medium" ? 5 : 3,
        real_world_context: spec.exam_context_type !== "isolated_knowledge",
        allowed_question_types: ["mc_single", "mc_multi"],
        status: "draft",
        version: "1.0.0",
      });

      globalIndex++;
    }
  }

  return rows;
}
