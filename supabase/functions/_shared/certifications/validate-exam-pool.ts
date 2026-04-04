const PROFILE_EXPECTED_TRAPS: Record<string, string[]> = {
  IHK_AUFSTIEG: ["typical_error", "misconception"],
  MEISTER: ["typical_error", "misconception"],
  FINANCE: ["calculation_trap", "typical_error"],
  AEVO: ["typical_error", "misconception"],
  CERT_TECH: ["misconception", "typical_error"],
  SECURITY: ["misconception", "typical_error"],
  PRIVACY: ["misconception", "typical_error"],
};

export type ExamPoolGateClass =
  | "pass"
  | "warning"
  | "targeted_regeneration_required"
  | "major_regeneration_required";

export type ExamPoolFinding = {
  code: string;
  severity: "info" | "warning" | "error" | "critical";
  detail: string;
  affected_ids?: string[];
  metric?: number;
  threshold?: number;
};

export type ExamQuestionRecord = {
  id: string;
  blueprint_id: string | null;
  competency_id: string | null;
  question_type: string | null;
  question_text: string | null;
  options: Array<{ id: string; text: string; is_correct: boolean }> | null;
  correct_answer: number | null;
  explanation: string | null;
  trap_type: string | null;
  conflict_type: string | null;
  review_state: string | null;
  status: string | null;
};

export type ExamPoolValidationResult = {
  certification_slug: string;
  certification_id: string;
  curriculum_id: string;
  validation_profile: string;
  total_questions: number;
  total_blueprints: number;
  gate_class: ExamPoolGateClass;
  findings: ExamPoolFinding[];
  coverage: {
    covered_blueprints: number;
    total_blueprints: number;
    coverage_pct: number;
  };
  distribution: {
    by_question_type: Record<string, number>;
    by_trap_type: Record<string, number>;
    by_conflict_type: Record<string, number>;
    by_review_state: Record<string, number>;
  };
};

export function validateExamPool(input: {
  certSlug: string;
  certId: string;
  curriculumId: string;
  validationProfile: string;
  questions: ExamQuestionRecord[];
  blueprintIds: string[];
}): ExamPoolValidationResult {
  const findings: ExamPoolFinding[] = [];
  const { certSlug, certId, curriculumId, validationProfile, questions, blueprintIds } = input;

  // --- Structural checks ---
  const emptyText = questions.filter((q) => !q.question_text?.trim());
  if (emptyText.length) {
    findings.push({
      code: "EMPTY_QUESTION_TEXT",
      severity: "error",
      detail: `${emptyText.length} questions have empty question_text`,
      affected_ids: emptyText.map((q) => q.id),
    });
  }

  const missingBlueprint = questions.filter((q) => !q.blueprint_id);
  if (missingBlueprint.length) {
    findings.push({
      code: "MISSING_BLUEPRINT_ID",
      severity: "critical",
      detail: `${missingBlueprint.length} questions missing blueprint_id`,
      affected_ids: missingBlueprint.map((q) => q.id),
    });
  }

  const missingCompetency = questions.filter((q) => !q.competency_id);
  if (missingCompetency.length) {
    findings.push({
      code: "MISSING_COMPETENCY_ID",
      severity: "error",
      detail: `${missingCompetency.length} questions missing competency_id`,
      affected_ids: missingCompetency.map((q) => q.id),
    });
  }

  const missingExplanation = questions.filter((q) => !q.explanation?.trim());
  if (missingExplanation.length) {
    findings.push({
      code: "MISSING_EXPLANATION",
      severity: "warning",
      detail: `${missingExplanation.length} questions missing explanation`,
      affected_ids: missingExplanation.map((q) => q.id),
    });
  }

  // --- Options validation ---
  const invalidOptions = questions.filter((q) => {
    if (!q.options || !Array.isArray(q.options)) return true;
    if (q.question_type === "true_false") return q.options.length !== 2;
    if (q.question_type === "mc_single" || q.question_type === "mc_multi") return q.options.length < 2;
    return false;
  });
  if (invalidOptions.length) {
    findings.push({
      code: "INVALID_OPTIONS",
      severity: "error",
      detail: `${invalidOptions.length} questions have invalid options payload`,
      affected_ids: invalidOptions.map((q) => q.id),
    });
  }

  // --- Correctness logic ---
  const invalidCorrectness = questions.filter((q) => {
    const opts = Array.isArray(q.options) ? q.options : [];
    const correctCount = opts.filter((o) => !!o.is_correct).length;
    if (q.question_type === "mc_single" || q.question_type === "true_false") return correctCount !== 1;
    if (q.question_type === "mc_multi") return correctCount < 1;
    return false;
  });
  if (invalidCorrectness.length) {
    findings.push({
      code: "INVALID_CORRECTNESS_LOGIC",
      severity: "error",
      detail: `${invalidCorrectness.length} questions have invalid correctness logic`,
      affected_ids: invalidCorrectness.map((q) => q.id),
    });
  }

  // --- Distribution ---
  const byQuestionType: Record<string, number> = {};
  const byTrapType: Record<string, number> = {};
  const byConflictType: Record<string, number> = {};
  const byReviewState: Record<string, number> = {};

  for (const q of questions) {
    if (q.question_type) byQuestionType[q.question_type] = (byQuestionType[q.question_type] ?? 0) + 1;
    if (q.trap_type) byTrapType[q.trap_type] = (byTrapType[q.trap_type] ?? 0) + 1;
    if (q.conflict_type) byConflictType[q.conflict_type] = (byConflictType[q.conflict_type] ?? 0) + 1;
    if (q.review_state) byReviewState[q.review_state] = (byReviewState[q.review_state] ?? 0) + 1;
  }

  // --- Missing trap_type ---
  const missingTrap = questions.filter((q) => !q.trap_type);
  if (missingTrap.length) {
    findings.push({
      code: "MISSING_TRAP_TYPE",
      severity: "warning",
      detail: `${missingTrap.length} questions missing trap_type`,
      affected_ids: missingTrap.map((q) => q.id),
    });
  }

  // --- Profile-specific trap distribution ---
  const expectedTraps = PROFILE_EXPECTED_TRAPS[validationProfile] ?? [];
  for (const trap of expectedTraps) {
    if (!byTrapType[trap]) {
      findings.push({
        code: "TRAP_DISTRIBUTION_INVALID",
        severity: "warning",
        detail: `Profile ${validationProfile} expects trap_type "${trap}" but none found`,
      });
    }
  }

  // --- Blueprint coverage ---
  const coveredBlueprintIds = new Set(questions.filter((q) => q.blueprint_id).map((q) => q.blueprint_id!));
  const totalBps = blueprintIds.length;
  const coveredBps = blueprintIds.filter((id) => coveredBlueprintIds.has(id)).length;
  const coveragePct = totalBps > 0 ? Math.round((coveredBps / totalBps) * 100) : 0;

  if (coveragePct < 100) {
    const missing = blueprintIds.filter((id) => !coveredBlueprintIds.has(id));
    findings.push({
      code: "BLUEPRINT_COVERAGE_GAP",
      severity: coveragePct < 80 ? "error" : "warning",
      detail: `Only ${coveredBps}/${totalBps} blueprints covered (${coveragePct}%)`,
      affected_ids: missing.slice(0, 20),
      metric: coveragePct,
      threshold: 100,
    });
  }

  // --- Gate classification ---
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  let gate_class: ExamPoolGateClass;
  if (criticalCount > 0) {
    gate_class = "major_regeneration_required";
  } else if (errorCount > 0) {
    gate_class = "targeted_regeneration_required";
  } else if (warningCount > 0) {
    gate_class = "warning";
  } else {
    gate_class = "pass";
  }

  return {
    certification_slug: certSlug,
    certification_id: certId,
    curriculum_id: curriculumId,
    validation_profile: validationProfile,
    total_questions: questions.length,
    total_blueprints: totalBps,
    gate_class,
    findings,
    coverage: {
      covered_blueprints: coveredBps,
      total_blueprints: totalBps,
      coverage_pct: coveragePct,
    },
    distribution: {
      by_question_type: byQuestionType,
      by_trap_type: byTrapType,
      by_conflict_type: byConflictType,
      by_review_state: byReviewState,
    },
  };
}
