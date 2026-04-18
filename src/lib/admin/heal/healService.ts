/**
 * SSOT Heal Service v1
 * ────────────────────
 * Zentraler Entry-Point für alle manuellen Heal-Aktionen.
 * Ersetzt die historisch fragmentierten Pfade:
 *   - recover_and_reenter_package (legacy)
 *   - direkte status-Transitions
 *   - lose verteilte runAdminOpsAction-Calls
 *
 * Zwei Modi:
 *   - SOFT  → admin-ops-actions.reset_to_step (Reentry, kein Job-Cancel)
 *   - HARD  → admin_manual_heal_package RPC (Cancel Jobs + Step-Reset + clear blocked_reason)
 *
 * Optionales Enqueue-Plan: Liste von Jobs die NACH dem Heal eingereiht werden.
 * (Realisiert über admin-ops-actions.enqueue_single_step bzw. dedizierte Repair-Actions.)
 */
import { supabase } from "@/integrations/supabase/client";
import {
  runAdminOpsAction,
  type AdminOpsActionType,
} from "@/integrations/supabase/admin-ops-actions";

export type HealMode = "soft" | "hard";

export interface HealEnqueueStep {
  /** admin-ops action that materialises a job (e.g. 'repair_exam_pool_quality'). */
  action: AdminOpsActionType;
  /** Optional extra payload merged into the action call. */
  payload?: Record<string, unknown>;
}

export interface RunHealParams {
  packageId: string;
  mode: HealMode;
  /** Required for hard heal; optional for soft (defaults to current step). */
  resetFromStep?: string;
  /** Audit reason — required. */
  reason: string;
  /** Optional cancel toggle for hard heal (default true). */
  cancelActiveJobs?: boolean;
  /** Optional follow-up jobs to enqueue post-heal. */
  enqueuePlan?: HealEnqueueStep[];
}

export interface HealResult {
  ok: boolean;
  mode: HealMode;
  packageId: string;
  reset?: unknown;
  enqueued: Array<{ action: string; ok: boolean; error?: string }>;
}

/**
 * Single SSOT entry point for any manual heal in admin UI.
 */
export async function runPackageHealAction(
  params: RunHealParams,
): Promise<HealResult> {
  const { packageId, mode, resetFromStep, reason, cancelActiveJobs = true, enqueuePlan } = params;

  let resetResult: unknown = null;

  if (mode === "soft") {
    if (!resetFromStep) {
      throw new Error("SOFT heal requires resetFromStep");
    }
    resetResult = await runAdminOpsAction("reset_to_step", {
      package_id: packageId,
      step_key: resetFromStep,
    });
  } else {
    // HARD: SECURITY DEFINER RPC handles cancel + reset + blocked_reason clear + audit
    const { data, error } = await (supabase as any).rpc("admin_manual_heal_package", {
      p_package_id: packageId,
      p_reset_from_step: resetFromStep ?? null,
      p_cancel_active_jobs: cancelActiveJobs,
      p_reason: reason,
    });
    if (error) throw new Error(error.message || "admin_manual_heal_package failed");
    resetResult = data;
  }

  const enqueued: HealResult["enqueued"] = [];
  if (enqueuePlan?.length) {
    for (const step of enqueuePlan) {
      try {
        await runAdminOpsAction(step.action, {
          package_id: packageId,
          ...(step.payload ?? {}),
        });
        enqueued.push({ action: step.action, ok: true });
      } catch (err: any) {
        enqueued.push({ action: step.action, ok: false, error: err?.message ?? String(err) });
      }
    }
  }

  return { ok: true, mode, packageId, reset: resetResult, enqueued };
}

/**
 * Mapping helper: derive recommended (mode, resetStep, enqueuePlan) from
 * a deficit signal. UI-Komponenten nutzen das, statt Hard-/Soft-Logik selbst zu schreiben.
 */
export interface HealRecommendation {
  mode: HealMode;
  resetFromStep?: string;
  enqueuePlan?: HealEnqueueStep[];
  rationale: string;
}

export function recommendHeal(input: {
  hardFailReasons?: string[];
  blockReason?: string | null;
  hasActiveJobs?: boolean;
  isStuck?: boolean;
  releaseClass?: "release_ok" | "release_warn" | "release_block" | null;
}): HealRecommendation {
  const reasons = (input.hardFailReasons ?? []).map((r) => r.toUpperCase());
  const stuck = !!input.isStuck;
  const block = (input.blockReason ?? "").toLowerCase();

  // 1. Stuck / loop / queued-without-job / repair-no-effect → HARD
  if (
    stuck ||
    block.includes("repair_no_effect") ||
    block.includes("queued_without_job") ||
    block.includes("active_jobs_exist") ||
    block.includes("pipeline_repair_required")
  ) {
    const stepGuess = guessRepairStep(reasons);
    return {
      mode: "hard",
      resetFromStep: stepGuess.step,
      enqueuePlan: stepGuess.enqueue,
      rationale: "Stuck / loop / pipeline_repair_required — Hard reset required.",
    };
  }

  // 2. release_ok with no active jobs → soft reentry to publish
  if (input.releaseClass === "release_ok" && !input.hasActiveJobs) {
    return {
      mode: "soft",
      resetFromStep: "auto_publish",
      rationale: "Release-OK and no active jobs — soft reentry to publish step.",
    };
  }

  // 3. Default: soft reentry to integrity check
  return {
    mode: "soft",
    resetFromStep: "run_integrity_check",
    rationale: "Default soft reentry: re-run integrity check.",
  };
}

function guessRepairStep(reasons: string[]): { step: string; enqueue: HealEnqueueStep[] } {
  if (reasons.some((r) => r.includes("MINICHECK"))) {
    return {
      step: "fanout_learning_content",
      enqueue: [{ action: "repair_minichecks" }],
    };
  }
  if (reasons.some((r) => r.includes("LESSON") || r.includes("PLACEHOLDER") || r.includes("TIER1"))) {
    return {
      step: "scaffold_learning_course",
      enqueue: [{ action: "repair_lessons" }],
    };
  }
  if (reasons.some((r) => r.includes("HANDBOOK"))) {
    return {
      step: "generate_handbook",
      enqueue: [{ action: "repair_handbook" }],
    };
  }
  if (reasons.some((r) => r.includes("ORAL_EXAM"))) {
    return {
      step: "generate_oral_exam",
      enqueue: [{ action: "repair_oral_exam" }],
    };
  }
  // Exam pool / bloom / coverage / hardish → repair_exam_pool_quality
  if (
    reasons.some(
      (r) =>
        r.includes("EXAM_POOL") ||
        r.includes("BLOOM") ||
        r.includes("COVERAGE") ||
        r.includes("HARDISH") ||
        r.includes("EASY_TOO_HIGH") ||
        r.includes("TRAP"),
    )
  ) {
    return {
      step: "generate_exam_pool",
      enqueue: [{ action: "repair_exam_pool_quality" }],
    };
  }
  // Generic fallback
  return {
    step: "run_integrity_check",
    enqueue: [],
  };
}
