/**
 * Exam Pool Validator — track-aware quality gates.
 *
 * Validates the exam question pool against the ContentProfile thresholds
 * for the given track. EXAM_FIRST has lower count thresholds but
 * equally strict trap/explanation coverage.
 */

import { getContentProfile, type TrapType } from "../contentProfiles";
import { normalizeTrack } from "../tracks";

interface ExamQuestionLike {
  status: string;
  explanation?: string | null;
  distractor_meta?: unknown;
  trap_type?: TrapType | null;
}

interface ValidationIssue {
  severity: "info" | "warning" | "hard";
  code: string;
  message: string;
}

export function validateExamPool(
  trackInput: unknown,
  questions: ExamQuestionLike[],
): {
  passed: boolean;
  issues: ValidationIssue[];
  stats: Record<string, unknown>;
} {
  const track = normalizeTrack(trackInput);
  const profile = getContentProfile(track);
  const approved = questions.filter((q) => q.status === "approved");
  const issues: ValidationIssue[] = [];

  // ── Count Gate ──────────────────────────────────────
  if (approved.length < profile.minApprovedExamQuestions) {
    issues.push({
      severity: "hard",
      code: "APPROVED_COUNT_TOO_LOW",
      message: `Approved question count ${approved.length} < ${profile.minApprovedExamQuestions}`,
    });
  }

  // ── Explanation Coverage ────────────────────────────
  const explanationCoverage =
    approved.length === 0
      ? 0
      : (approved.filter((q) => !!q.explanation).length / approved.length) * 100;

  if (explanationCoverage < profile.minExplanationCoveragePct) {
    issues.push({
      severity: "hard",
      code: "EXPLANATION_COVERAGE_TOO_LOW",
      message: `Explanation coverage ${explanationCoverage.toFixed(1)}% < ${profile.minExplanationCoveragePct}%`,
    });
  }

  // ── Distractor Coverage ────────────────────────────
  const distractorCoverage =
    approved.length === 0
      ? 0
      : (approved.filter((q) => !!q.distractor_meta).length / approved.length) * 100;

  if (distractorCoverage < profile.minDistractorCoveragePct) {
    issues.push({
      severity: "hard",
      code: "DISTRACTOR_COVERAGE_TOO_LOW",
      message: `Distractor coverage ${distractorCoverage.toFixed(1)}% < ${profile.minDistractorCoveragePct}%`,
    });
  }

  // ── Trap Coverage ──────────────────────────────────
  const trapCoverage =
    approved.length === 0
      ? 0
      : (approved.filter((q) => !!q.trap_type).length / approved.length) * 100;

  if (profile.requireTrapCoverage && trapCoverage < profile.minTrapCoveragePct) {
    issues.push({
      severity: "hard",
      code: "TRAP_COVERAGE_TOO_LOW",
      message: `Trap coverage ${trapCoverage.toFixed(1)}% < ${profile.minTrapCoveragePct}%`,
    });
  }

  // ── Trap Distribution ──────────────────────────────
  const trapCounts: Record<TrapType, number> = {
    misconception: 0,
    typical_error: 0,
    calculation_trap: 0,
  };

  for (const q of approved) {
    if (q.trap_type && q.trap_type in trapCounts) {
      trapCounts[q.trap_type]++;
    }
  }

  const trapTaggedTotal = Object.values(trapCounts).reduce((a, b) => a + b, 0);

  if (trapTaggedTotal > 0) {
    (Object.keys(trapCounts) as TrapType[]).forEach((type) => {
      const pct = (trapCounts[type] / trapTaggedTotal) * 100;
      const rule = profile.trapDistribution[type];

      if (pct < rule.hardBelow) {
        issues.push({
          severity: "hard",
          code: `TRAP_DISTRIBUTION_${type.toUpperCase()}_HARD`,
          message: `${type} share ${pct.toFixed(1)}% < hard floor ${rule.hardBelow}%`,
        });
      } else if (pct < rule.warnBelow) {
        issues.push({
          severity: "warning",
          code: `TRAP_DISTRIBUTION_${type.toUpperCase()}_WARN`,
          message: `${type} share ${pct.toFixed(1)}% < warn floor ${rule.warnBelow}%`,
        });
      }
    });
  }

  return {
    passed: !issues.some((i) => i.severity === "hard"),
    issues,
    stats: {
      track,
      approved_count: approved.length,
      explanation_coverage_pct: Number(explanationCoverage.toFixed(1)),
      distractor_coverage_pct: Number(distractorCoverage.toFixed(1)),
      trap_coverage_pct: Number(trapCoverage.toFixed(1)),
      trap_counts: trapCounts,
    },
  };
}
