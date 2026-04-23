/**
 * SSOT Heal Service v2
 * ────────────────────
 * Zentraler Entry-Point für alle manuellen Heal-Aktionen.
 *
 * Härtungen ggü. v1:
 *   - Promise<HealResult> Typ-Signatur korrekt
 *   - Reason-Schema erzwungen (assertValidHealReason)
 *   - enqueuePlan über harte Action-Registry (HealEnqueueAction → AdminOpsAction)
 *   - Soft-Heal Auto-Upgrade auf Hard wenn Snapshot stuck/loop signalisiert
 *
 * Recommendation lebt in healRecommendations.ts (datenbasiert, nicht reason-only).
 */
import { supabase } from "@/integrations/supabase/client";
import { runAdminOpsAction } from "@/integrations/supabase/admin-ops-actions";
import {
  resolveHealOpsAction,
  type HealEnqueueAction,
} from "./healActionRegistry";
import { assertValidHealReason } from "./healReason";
import {
  shouldForceHardHeal,
  type HealSnapshot,
  type HealMode,
} from "./healRecommendations";

export type { HealMode, HealSnapshot } from "./healRecommendations";
export { recommendHeal } from "./healRecommendations";
export type { HealEnqueueAction } from "./healActionRegistry";
export { buildHealReason } from "./healReason";

export interface HealEnqueueStep {
  action: HealEnqueueAction;
  payload?: Record<string, unknown>;
}

export interface RunHealParams {
  packageId: string;
  mode: HealMode;
  /** Required for hard heal; required for soft heal (no implicit fallback). */
  resetFromStep: string;
  /** SSOT reason — must match buildHealReason() schema. */
  reason: string;
  /** Optional cancel toggle for hard heal (default true). */
  cancelActiveJobs?: boolean;
  /** Optional follow-up actions resolved through HealActionRegistry. */
  enqueuePlan?: HealEnqueueStep[];
  /** Optional snapshot — used for Soft→Hard auto-upgrade guard. */
  snapshot?: HealSnapshot;
  /** Free-text operator note (audit-only, not part of primary reason). */
  operatorNote?: string;
}

export interface HealResult {
  ok: boolean;
  mode: HealMode;
  packageId: string;
  reset?: unknown;
  enqueued: Array<{ action: HealEnqueueAction; ok: boolean; error?: string }>;
  upgradedToHard: boolean;
  /** Anzahl tatsächlich verbrauchter Hard-Heal-Versuche (1..maxRetries+1). */
  attempts?: number;
  /** Job-IDs die durch den Heal gequeued/getouched wurden (best-effort). */
  jobIds?: string[];
  /** Kurzer Code für UI-Tagging: "ok" | "breaker" | "error" */
  status?: "ok" | "breaker" | "error";
  /** True wenn der Lauf wegen HARD_FAIL_BREAKER abgebrochen wurde. */
  manualReviewRequired?: boolean;
  /** Snapshot-ID für manuelles Rollback (nur bei Hard-Heal v2). */
  snapshotId?: string;
  /** Verification-Report-ID (nur bei Hard-Heal v2). */
  reportId?: string;
  /** True wenn das Verify-Gate erfolgreich war. */
  verifyPassed?: boolean;
  /** Anzahl stornierter aktiver Jobs während Hard-Heal. */
  jobsCancelled?: number;
  /** Conflict-Check-Ergebnis (Snapshot vor Heal). */
  conflicts?: unknown;
}

/**
 * Tokens, die ein HARD_FAIL_BREAKER / dauerhafter Fehler signalisieren.
 * Bei Treffer: KEIN weiterer Retry — Operator muss manuell reviewen.
 */
const HARD_FAIL_BREAKER_TOKENS = [
  "HARD_FAIL_BREAKER",
  "HARD_FAIL_REPAIR_EXHAUSTED",
  "HARD_FAIL:",
  "MANUAL_REVIEW",
  "REPAIR_EXHAUSTED",
  "STALE_LOCK_LOOP_HARD_KILL",
  "SSOT VIOLATION",
];

export class HardFailBreakerError extends Error {
  readonly breaker = true;
  constructor(message: string) {
    super(message);
    this.name = "HardFailBreakerError";
  }
}

function isHardFailBreaker(msg: string | undefined | null): boolean {
  if (!msg) return false;
  const upper = msg.toUpperCase();
  return HARD_FAIL_BREAKER_TOKENS.some((t) => upper.includes(t.toUpperCase()));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchRecentJobIds(packageId: string, sinceIso: string): Promise<string[]> {
  try {
    const { data } = await (supabase as any)
      .from("job_queue")
      .select("id")
      .eq("package_id", packageId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(20);
    return ((data as Array<{ id: string }> | null) ?? []).map((r) => r.id);
  } catch {
    return [];
  }
}

export async function runPackageHealAction(
  params: RunHealParams,
): Promise<HealResult> {
  const {
    packageId,
    resetFromStep,
    reason,
    cancelActiveJobs = true,
    enqueuePlan,
    snapshot,
    operatorNote,
  } = params;

  // ── 1. Reason-Schema enforcement ──
  assertValidHealReason(reason);
  if (!resetFromStep) {
    throw new Error("runPackageHealAction: resetFromStep is required");
  }

  // ── 2. Soft → Hard auto-upgrade guard ──
  let mode = params.mode;
  let upgradedToHard = false;
  if (mode === "soft" && snapshot && shouldForceHardHeal(snapshot)) {
    mode = "hard";
    upgradedToHard = true;
  }

  const startedAt = new Date().toISOString();

  // ── 3. Execute reset ──
  // Soft-Heal: kein Retry (idempotent, billig).
  // Hard-Heal: bis zu 3 Versuche mit exponentiellem Backoff (1s, 2s, 4s).
  //            HARD_FAIL_BREAKER → sofort abbrechen, manuelles Review erforderlich.
  let resetResult: unknown = null;
  let attempts = 0;
  const MAX_HARD_ATTEMPTS = 3;
  const BASE_DELAY_MS = 1000;

  if (mode === "soft") {
    attempts = 1;
    resetResult = await runAdminOpsAction("reset_to_step", {
      package_id: packageId,
      step_key: resetFromStep,
    });
  } else {
    // Map planned enqueuePlan → konkrete job_types für Conflict-Check
    const plannedJobTypes = (enqueuePlan ?? [])
      .map((s) => `package_${resolveHealOpsAction(s.action).replace(/^repair_/, "repair_")}`)
      // best-effort: convert ops action → job_type prefix
      .map((s) => (s.startsWith("package_") ? s : `package_${s}`));

    let lastErr: unknown = null;
    for (let i = 0; i < MAX_HARD_ATTEMPTS; i++) {
      attempts = i + 1;
      // v2: Snapshot + Conflict-Check + Verify-Gate in einer Transaktion
      const { data, error } = await (supabase as any).rpc("admin_manual_heal_package_v2", {
        p_package_id: packageId,
        p_reset_step_keys: [resetFromStep],
        p_reason: operatorNote ? `${reason} | note=${operatorNote}` : reason,
        p_cancel_active_jobs: cancelActiveJobs,
        p_planned_job_types: plannedJobTypes.length ? plannedJobTypes : null,
        p_operator: operatorNote ?? null,
      });
      if (!error) {
        resetResult = data;
        lastErr = null;
        break;
      }
      const msg = error.message || "admin_manual_heal_package_v2 failed";
      lastErr = error;

      // BREAKER: Sofort raus — kein weiterer Retry, Operator muss reviewen.
      if (isHardFailBreaker(msg)) {
        const jobIds = await fetchRecentJobIds(packageId, startedAt);
        const breakerErr = new HardFailBreakerError(
          `HARD_FAIL_BREAKER nach ${attempts} Versuch(en): ${msg}`,
        );
        (breakerErr as any).jobIds = jobIds;
        (breakerErr as any).packageId = packageId;
        throw breakerErr;
      }

      // Letzter Versuch verbraucht → durchreichen
      if (i === MAX_HARD_ATTEMPTS - 1) break;

      // Exponentieller Backoff
      await sleep(BASE_DELAY_MS * Math.pow(2, i));
    }
    if (lastErr) {
      throw new Error(
        (lastErr as { message?: string })?.message ||
          "admin_manual_heal_package_v2 failed",
      );
    }
  }

  // ── 4. Resolve & execute enqueuePlan via Action Registry ──
  const enqueued: HealResult["enqueued"] = [];
  if (enqueuePlan?.length) {
    for (const step of enqueuePlan) {
      try {
        const opsAction = resolveHealOpsAction(step.action);
        await runAdminOpsAction(opsAction, {
          package_id: packageId,
          ...(step.payload ?? {}),
        });
        enqueued.push({ action: step.action, ok: true });
      } catch (err: any) {
        enqueued.push({ action: step.action, ok: false, error: err?.message ?? String(err) });
      }
    }
  }

  const jobIds = await fetchRecentJobIds(packageId, startedAt);

  // Extract v2 fields if hard-heal returned them
  const v2Data = (mode === "hard" && resetResult && typeof resetResult === "object")
    ? (resetResult as Record<string, unknown>)
    : {};

  return {
    ok: true,
    mode,
    packageId,
    reset: resetResult,
    enqueued,
    upgradedToHard,
    attempts,
    jobIds,
    status: "ok",
    manualReviewRequired: false,
    snapshotId: typeof v2Data.snapshot_id === "string" ? v2Data.snapshot_id : undefined,
    reportId: typeof v2Data.report_id === "string" ? v2Data.report_id : undefined,
    verifyPassed: typeof v2Data.verify_passed === "boolean" ? v2Data.verify_passed : undefined,
    jobsCancelled: typeof v2Data.jobs_cancelled === "number" ? v2Data.jobs_cancelled : undefined,
    conflicts: v2Data.conflicts,
  };
}
