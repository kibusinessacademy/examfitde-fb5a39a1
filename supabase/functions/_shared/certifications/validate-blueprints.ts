/**
 * validate-blueprints — profile-aware blueprint quality gate
 *
 * Gate Classes:
 *   pass                          — all checks green
 *   warning                       — minor deviations, proceed
 *   targeted_regeneration_required — specific gaps must be filled
 *   major_regeneration_required    — structural problems
 *
 * Reason Codes:
 *   BLUEPRINT_COVERAGE_GAP        — competency without any blueprint
 *   BLUEPRINT_TYPE_MISSING         — required knowledge_type absent for profile
 *   TRAP_DISTRIBUTION_INVALID      — trap types outside profile corridor
 *   DIFFICULTY_DISTRIBUTION_INVALID — easy/medium/hard outside tolerance
 *   INVALID_EXAM_RELEVANCE_SCORE   — score outside [1..5]
 *   EMPTY_CANONICAL_STATEMENT      — blank canonical_statement
 *   EMPTY_NAME                     — blank name
 *   MISSING_COMPETENCY_ID          — null competency_id
 *   MISSING_CURRICULUM_ID          — null curriculum_id
 *   LOW_BLUEPRINT_COUNT            — total blueprints below minimum
 */

// ── Profile requirements ─────────────────────────────────────────

const PROFILE_REQUIRED_TYPES: Record<string, string[]> = {
  IHK_AUFSTIEG: ["concept", "procedure"],
  MEISTER: ["concept", "procedure"],
  FINANCE: ["calculation", "procedure", "concept"],
  AEVO: ["procedure", "concept", "regulation"],
  CERT_TECH: ["concept", "procedure"],
  SECURITY: ["concept", "regulation", "procedure"],
  PRIVACY: ["regulation", "concept"],
};

const PROFILE_EXPECTED_TRAPS: Record<string, string[]> = {
  IHK_AUFSTIEG: ["typical_error", "misconception"],
  MEISTER: ["typical_error", "misconception"],
  FINANCE: ["calculation_trap", "typical_error"],
  AEVO: ["typical_error", "misconception"],
  CERT_TECH: ["misconception", "typical_error"],
  SECURITY: ["misconception", "typical_error"],
  PRIVACY: ["misconception", "typical_error"],
};

// ── Types ────────────────────────────────────────────────────────

export type GateClass =
  | "pass"
  | "warning"
  | "targeted_regeneration_required"
  | "major_regeneration_required";

export interface ValidationFinding {
  code: string;
  severity: "info" | "warning" | "error" | "critical";
  detail: string;
  affected_ids?: string[];
  metric?: number;
  threshold?: number;
}

export interface BlueprintValidationResult {
  certification_slug: string;
  certification_id: string;
  curriculum_id: string;
  validation_profile: string;
  total_blueprints: number;
  total_competencies: number;
  gate_class: GateClass;
  findings: ValidationFinding[];
  distribution: {
    by_knowledge_type: Record<string, number>;
    by_cognitive_level: Record<string, number>;
    by_trap_type: Record<string, number>;
    difficulty_approx: Record<string, number>;
  };
  coverage: {
    competencies_covered: number;
    competencies_total: number;
    coverage_pct: number;
  };
}

// ── Blueprint row shape (from DB) ────────────────────────────────

export interface BlueprintRecord {
  id: string;
  curriculum_id: string;
  competency_id: string | null;
  learning_field_id: string | null;
  name: string;
  canonical_statement: string;
  knowledge_type: string;
  cognitive_level: string;
  didactic_intent: string;
  exam_context_type: string;
  expected_trap_type: string | null;
  exam_relevance_score: number;
  allowed_question_types: string[];
  status: string;
}

// ── Core validation ──────────────────────────────────────────────

export function validateBlueprints(input: {
  certSlug: string;
  certId: string;
  curriculumId: string;
  validationProfile: string;
  blueprints: BlueprintRecord[];
  competencyIds: string[];
}): BlueprintValidationResult {
  const { certSlug, certId, curriculumId, validationProfile, blueprints, competencyIds } = input;
  const findings: ValidationFinding[] = [];
  const profile = validationProfile;

  // ── 1. Structural checks per blueprint ──────────────────────

  const emptyNames = blueprints.filter((b) => !b.name?.trim());
  if (emptyNames.length) {
    findings.push({
      code: "EMPTY_NAME",
      severity: "error",
      detail: `${emptyNames.length} blueprints have empty names`,
      affected_ids: emptyNames.map((b) => b.id),
      metric: emptyNames.length,
    });
  }

  const emptyCanonical = blueprints.filter((b) => !b.canonical_statement?.trim());
  if (emptyCanonical.length) {
    findings.push({
      code: "EMPTY_CANONICAL_STATEMENT",
      severity: "error",
      detail: `${emptyCanonical.length} blueprints have empty canonical_statement`,
      affected_ids: emptyCanonical.map((b) => b.id),
      metric: emptyCanonical.length,
    });
  }

  const missingCurriculum = blueprints.filter((b) => !b.curriculum_id);
  if (missingCurriculum.length) {
    findings.push({
      code: "MISSING_CURRICULUM_ID",
      severity: "critical",
      detail: `${missingCurriculum.length} blueprints missing curriculum_id`,
      affected_ids: missingCurriculum.map((b) => b.id),
    });
  }

  const missingCompetency = blueprints.filter((b) => !b.competency_id);
  if (missingCompetency.length) {
    findings.push({
      code: "MISSING_COMPETENCY_ID",
      severity: "error",
      detail: `${missingCompetency.length} blueprints missing competency_id`,
      affected_ids: missingCompetency.map((b) => b.id),
      metric: missingCompetency.length,
    });
  }

  const invalidRelevance = blueprints.filter(
    (b) => b.exam_relevance_score < 1 || b.exam_relevance_score > 5
  );
  if (invalidRelevance.length) {
    findings.push({
      code: "INVALID_EXAM_RELEVANCE_SCORE",
      severity: "warning",
      detail: `${invalidRelevance.length} blueprints have exam_relevance_score outside [1..5]`,
      affected_ids: invalidRelevance.map((b) => b.id),
    });
  }

  const emptyQuestionTypes = blueprints.filter(
    (b) => !b.allowed_question_types || b.allowed_question_types.length === 0
  );
  if (emptyQuestionTypes.length) {
    findings.push({
      code: "EMPTY_ALLOWED_QUESTION_TYPES",
      severity: "warning",
      detail: `${emptyQuestionTypes.length} blueprints have empty allowed_question_types`,
      affected_ids: emptyQuestionTypes.map((b) => b.id),
    });
  }

  // ── 2. Coverage: competencies → blueprints ──────────────────

  const coveredCompetencies = new Set(
    blueprints.filter((b) => b.competency_id).map((b) => b.competency_id!)
  );
  const uncoveredCompetencies = competencyIds.filter((c) => !coveredCompetencies.has(c));
  const coveragePct = competencyIds.length > 0
    ? Math.round((coveredCompetencies.size / competencyIds.length) * 100)
    : 0;

  if (uncoveredCompetencies.length) {
    findings.push({
      code: "BLUEPRINT_COVERAGE_GAP",
      severity: uncoveredCompetencies.length > competencyIds.length * 0.2 ? "critical" : "error",
      detail: `${uncoveredCompetencies.length}/${competencyIds.length} competencies have no blueprints`,
      affected_ids: uncoveredCompetencies,
      metric: coveragePct,
      threshold: 100,
    });
  }

  // ── 3. Profile type coverage ────────────────────────────────

  const byKnowledgeType: Record<string, number> = {};
  const byCogLevel: Record<string, number> = {};
  const byTrapType: Record<string, number> = {};

  for (const bp of blueprints) {
    byKnowledgeType[bp.knowledge_type] = (byKnowledgeType[bp.knowledge_type] ?? 0) + 1;
    byCogLevel[bp.cognitive_level] = (byCogLevel[bp.cognitive_level] ?? 0) + 1;
    if (bp.expected_trap_type) {
      byTrapType[bp.expected_trap_type] = (byTrapType[bp.expected_trap_type] ?? 0) + 1;
    }
  }

  const requiredTypes = PROFILE_REQUIRED_TYPES[profile] ?? ["concept", "procedure"];
  const missingTypes = requiredTypes.filter((t) => !byKnowledgeType[t]);
  if (missingTypes.length) {
    findings.push({
      code: "BLUEPRINT_TYPE_MISSING",
      severity: "error",
      detail: `Profile ${profile} requires [${requiredTypes.join(", ")}] but missing: [${missingTypes.join(", ")}]`,
      metric: missingTypes.length,
      threshold: 0,
    });
  }

  // ── 4. Difficulty distribution (derived from cognitive_level) ─

  const total = blueprints.length;
  // Map cognitive_level → approximate difficulty
  const difficultyMap: Record<string, string> = {
    remember: "easy",
    understand: "medium",
    apply: "hard",
    analyze: "hard",
    evaluate: "hard",
    create: "hard",
  };
  const byDifficulty: Record<string, number> = {};
  for (const bp of blueprints) {
    const d = difficultyMap[bp.cognitive_level] ?? "medium";
    byDifficulty[d] = (byDifficulty[d] ?? 0) + 1;
  }

  if (total >= 10) {
    const easyPct = ((byDifficulty["easy"] ?? 0) / total) * 100;
    const hardPct = ((byDifficulty["hard"] ?? 0) / total) * 100;

    // Tolerance: easy 10-40%, hard 10-40%
    if (easyPct < 10 || easyPct > 40) {
      findings.push({
        code: "DIFFICULTY_DISTRIBUTION_INVALID",
        severity: "warning",
        detail: `Easy blueprints at ${Math.round(easyPct)}%, expected 10-40%`,
        metric: Math.round(easyPct),
        threshold: 25,
      });
    }
    if (hardPct < 10 || hardPct > 40) {
      findings.push({
        code: "DIFFICULTY_DISTRIBUTION_INVALID",
        severity: "warning",
        detail: `Hard blueprints at ${Math.round(hardPct)}%, expected 10-40%`,
        metric: Math.round(hardPct),
        threshold: 25,
      });
    }
  }

  // ── 5. Trap distribution ────────────────────────────────────

  const expectedTraps = PROFILE_EXPECTED_TRAPS[profile] ?? ["typical_error"];
  const missingTraps = expectedTraps.filter((t) => !byTrapType[t]);
  if (missingTraps.length && total >= 5) {
    findings.push({
      code: "TRAP_DISTRIBUTION_INVALID",
      severity: "warning",
      detail: `Profile ${profile} expects trap types [${expectedTraps.join(", ")}] but missing: [${missingTraps.join(", ")}]`,
      metric: missingTraps.length,
    });
  }

  // ── 6. Minimum count ───────────────────────────────────────

  const minBlueprints = Math.max(10, competencyIds.length * 2);
  if (total < minBlueprints) {
    findings.push({
      code: "LOW_BLUEPRINT_COUNT",
      severity: total < minBlueprints * 0.5 ? "critical" : "error",
      detail: `${total} blueprints, minimum ${minBlueprints} expected`,
      metric: total,
      threshold: minBlueprints,
    });
  }

  // ── Gate classification ─────────────────────────────────────

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  let gateClass: GateClass;
  if (criticalCount > 0) {
    gateClass = "major_regeneration_required";
  } else if (errorCount > 2) {
    gateClass = "targeted_regeneration_required";
  } else if (errorCount > 0 || warningCount > 2) {
    gateClass = "warning";
  } else {
    gateClass = "pass";
  }

  return {
    certification_slug: certSlug,
    certification_id: certId,
    curriculum_id: curriculumId,
    validation_profile: profile,
    total_blueprints: total,
    total_competencies: competencyIds.length,
    gate_class: gateClass,
    findings,
    distribution: {
      by_knowledge_type: byKnowledgeType,
      by_cognitive_level: byCogLevel,
      by_trap_type: byTrapType,
      difficulty_approx: byDifficulty,
    },
    coverage: {
      competencies_covered: coveredCompetencies.size,
      competencies_total: competencyIds.length,
      coverage_pct: coveragePct,
    },
  };
}
