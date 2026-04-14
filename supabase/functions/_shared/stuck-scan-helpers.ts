/**
 * stuck-scan shared helpers: utility functions, types, and constants.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export type SupabaseClient = ReturnType<typeof createClient>;

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function isPermanentStepFailure(step: any): boolean {
  const meta = (step?.meta ?? {}) as Record<string, unknown>;
  const cls = String(meta?.last_error_class ?? "");
  if (cls === "permanent") return true;
  const kind = String(meta?.last_error_kind ?? "");
  if (["check_violation", "not_null_violation", "foreign_key_violation", "rls_denied", "unique_violation"].includes(kind)) return true;
  const lastErr = String(step?.last_error ?? "");
  if (lastErr.toUpperCase().includes("SSOT_GUARD")) return true;
  if (lastErr.toUpperCase().includes("HTTP 422 PERMANENT")) return true;
  return false;
}

// ═══════════════════════════════════════════════════════
//  SSOT: Centralized Terminal Retry Loop Detection
// ═══════════════════════════════════════════════════════
// All watchers, scanners, and healers MUST use these
// functions instead of ad-hoc loop detection.
// ═══════════════════════════════════════════════════════

/** Known terminal error patterns that indicate a job is in an unrecoverable loop. */
const TERMINAL_LOOP_PATTERNS = [
  "STALE_LOCK_RECOVERY",
  "STALE_LOCK_LOOP_COOLDOWN",
  "STALE_LOCK_EXHAUSTED",
  "LOOP_KILLED",
  "ZOMBIE_TERMINAL_FAIL",
  "LOCK_CHURN",
] as const;

/** Minimum attempts before a job qualifies as a terminal retry loop. */
const TERMINAL_LOOP_MIN_ATTEMPTS = 4;

/**
 * Determines whether a job is in a terminal retry loop —
 * i.e., it will never complete successfully and should not
 * block step finalization or be counted as "genuinely active."
 *
 * This is the SSOT function. All stuck-scan, watchdog, and
 * healer code MUST call this instead of inline checks.
 */
export function isTerminalRetryLoop(job: {
  attempts?: number | null;
  last_error?: string | null;
  status?: string | null;
}): boolean {
  const attempts = job.attempts ?? 0;
  const lastError = String(job.last_error ?? "");

  // Pattern match: known loop signatures with sufficient attempts
  if (attempts >= TERMINAL_LOOP_MIN_ATTEMPTS) {
    for (const pattern of TERMINAL_LOOP_PATTERNS) {
      if (lastError.includes(pattern)) return true;
    }
  }

  // High-attempt jobs with repeated 5xx errors (no state change)
  if (attempts >= 8 && lastError.startsWith("HTTP 5")) return true;

  // Reclaim exhaustion
  if (attempts >= 10) return true;

  return false;
}

/**
 * Filters a list of jobs to only those that are genuinely active
 * (i.e., NOT in a terminal retry loop). Use this to decide
 * whether a step can be finalized despite having "active" jobs.
 */
export function filterGenuinelyActiveJobs<T extends {
  attempts?: number | null;
  last_error?: string | null;
  status?: string | null;
}>(jobs: T[]): { active: T[]; terminal: T[] } {
  const active: T[] = [];
  const terminal: T[] = [];
  for (const j of jobs) {
    if (isTerminalRetryLoop(j)) {
      terminal.push(j);
    } else {
      active.push(j);
    }
  }
  return { active, terminal };
}

// ═══════════════════════════════════════════════════════
//  SSOT: Step Finalizability Check
// ═══════════════════════════════════════════════════════
// Central truth for "can this step be marked done?"
// All watchers, healers, and scanners MUST use this
// instead of ad-hoc job-count checks.
// ═══════════════════════════════════════════════════════

export interface StepFinalizabilityResult {
  finalizable: boolean;
  reason: string;
  genuinelyActiveJobs: number;
  terminalJobs: number;
  hasCompletionSignal: boolean;
}

/**
 * SSOT function: determines whether a step can be finalized.
 *
 * A step is finalizable when ALL conditions are met:
 *   1. meta.batch_complete=true OR meta.ok=true (completion signal exists)
 *   2. No genuinely active jobs remain (terminal loops don't count)
 *   3. Step is in a non-terminal status (queued/running/enqueued)
 *
 * This replaces all inline "count active jobs" checks across
 * stuck-scan-zombies, stuck-scan-healers, and any future watcher.
 *
 * NOTE: This does NOT check postconditions (hollow guard).
 * Postconditions are enforced by markStepDone() as a separate layer.
 * This function answers: "should we ATTEMPT finalization?"
 * markStepDone answers: "is the content actually complete?"
 */
export async function isStepFinalizable(
  sb: SupabaseClient,
  step: {
    package_id: string;
    step_key: string;
    status: string;
    meta: Record<string, unknown>;
    started_at?: string | null;
    updated_at?: string;
  },
  jobType: string | null,
  opts?: { minAgeMs?: number },
): Promise<StepFinalizabilityResult> {
  const meta = step.meta ?? {};
  const hasBatchComplete = meta.batch_complete === true;
  const hasMetaOk = meta.ok === true;
  const hasCompletionSignal = hasBatchComplete || hasMetaOk;

  // No completion signal → not finalizable
  if (!hasCompletionSignal) {
    return { finalizable: false, reason: "no_completion_signal", genuinelyActiveJobs: 0, terminalJobs: 0, hasCompletionSignal: false };
  }

  // Still flagged for regeneration → not finalizable
  if (meta.needs_regen && Number(meta.needs_regen) > 0) {
    return { finalizable: false, reason: "needs_regen", genuinelyActiveJobs: 0, terminalJobs: 0, hasCompletionSignal: true };
  }

  // Age check (prevents premature finalization)
  const minAge = opts?.minAgeMs ?? 5 * 60 * 1000;
  const refTime = step.started_at ?? step.updated_at;
  if (refTime) {
    const ageMs = Date.now() - new Date(refTime).getTime();
    if (ageMs < minAge) {
      return { finalizable: false, reason: "too_young", genuinelyActiveJobs: 0, terminalJobs: 0, hasCompletionSignal: true };
    }
  }

  // Job liveness check — the critical SSOT layer
  let genuinelyActiveJobs = 0;
  let terminalJobCount = 0;

  if (jobType) {
    const { data: activeJobs } = await sb
      .from("job_queue")
      .select("id, status, attempts, last_error")
      .eq("package_id", step.package_id)
      .eq("job_type", jobType)
      .in("status", ["pending", "processing"]);

    const { active, terminal } = filterGenuinelyActiveJobs(activeJobs ?? []);
    genuinelyActiveJobs = active.length;
    terminalJobCount = terminal.length;

    if (genuinelyActiveJobs > 0) {
      return { finalizable: false, reason: `genuinely_active_jobs:${genuinelyActiveJobs}`, genuinelyActiveJobs, terminalJobs: terminalJobCount, hasCompletionSignal: true };
    }
  }

  return {
    finalizable: true,
    reason: "all_conditions_met",
    genuinelyActiveJobs: 0,
    terminalJobs: terminalJobCount,
    hasCompletionSignal: true,
  };
}

/**
 * Cancel terminal-loop jobs that are blocking finalization.
 * Call this AFTER isStepFinalizable returns finalizable=true
 * and terminalJobs > 0.
 */
export async function cancelTerminalLoopJobs(
  sb: SupabaseClient,
  packageId: string,
  jobType: string,
): Promise<number> {
  const { data: jobs } = await sb
    .from("job_queue")
    .select("id, attempts, last_error")
    .eq("package_id", packageId)
    .eq("job_type", jobType)
    .in("status", ["pending", "processing"]);

  const { terminal } = filterGenuinelyActiveJobs(jobs ?? []);
  for (const tj of terminal) {
    await sb.from("job_queue").update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      last_error: `TERMINAL_LOOP_AUTO_CANCEL: ${(tj as any).attempts} attempts, pattern: ${String((tj as any).last_error).slice(0, 80)}`,
    }).eq("id", (tj as any).id);
  }
  return terminal.length;
}

export async function safeRpc(
  sb: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[stuck-scan] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[stuck-scan] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
  }
}

// ═══════════════════════════════════════════════════════
//  SSOT: Track Step Applicability Check
// ═══════════════════════════════════════════════════════
// All healers, admin-ops, and orchestrators MUST use this
// before resetting a step to "queued" or enqueuing a job.
// ═══════════════════════════════════════════════════════

/** Cache for track lookups — avoids repeated DB hits within a single scan cycle */
const _trackCache = new Map<string, string | null>();

/**
 * Resolve the product track for a given package_id.
 * Returns null if the package or track is unknown.
 */
export async function resolvePackageTrack(
  sb: SupabaseClient,
  packageId: string,
): Promise<string | null> {
  if (_trackCache.has(packageId)) return _trackCache.get(packageId)!;
  const { data, error } = await sb
    .from("course_packages")
    .select("track")
    .eq("id", packageId)
    .maybeSingle();
  const track = error ? null : (data?.track as string | null) ?? null;
  _trackCache.set(packageId, track);
  return track;
}

/**
 * Check if a step_key is applicable for the given package's track.
 * Returns { applicable: true } if the step should run,
 * { applicable: false, reason } if it must be skipped.
 *
 * Falls back to applicable=true if the track is unknown or the
 * step has no entry in track_step_applicability (fail-open for
 * new steps not yet registered).
 */
export async function isStepApplicableForPackage(
  sb: SupabaseClient,
  packageId: string,
  stepKey: string,
): Promise<{ applicable: boolean; reason?: string; track?: string }> {
  const track = await resolvePackageTrack(sb, packageId);
  if (!track) return { applicable: true, reason: "track_unknown_fail_open" };

  const { data, error } = await sb
    .from("track_step_applicability")
    .select("should_run")
    .eq("track", track)
    .eq("step_key", stepKey)
    .maybeSingle();

  if (error || !data) return { applicable: true, reason: "no_applicability_entry_fail_open", track };

  if (!data.should_run) {
    return { applicable: false, reason: `track_not_applicable:${track}`, track };
  }
  return { applicable: true, track };
}

/**
 * If a step is not applicable for its track, auto-skip it and log.
 * Returns true if the step was skipped.
 */
export async function autoSkipIfNotApplicable(
  sb: SupabaseClient,
  packageId: string,
  stepKey: string,
  source: string,
): Promise<boolean> {
  const check = await isStepApplicableForPackage(sb, packageId, stepKey);
  if (check.applicable) return false;

  await sb.from("package_steps").update({
    status: "skipped",
    updated_at: new Date().toISOString(),
    meta: {
      skip_reason: "track_not_applicable",
      skipped_by: source,
      skipped_at: new Date().toISOString(),
      track: check.track,
    },
  }).eq("package_id", packageId).eq("step_key", stepKey);

  await sb.from("auto_heal_log").insert({
    action_type: "ssot_applicability_auto_skip",
    trigger_source: source,
    target_type: "package_step",
    target_id: packageId,
    result_status: "applied",
    result_detail: `Step ${stepKey} auto-skipped: ${check.reason}`,
    metadata: { step_key: stepKey, track: check.track, reason: check.reason },
  }).catch(() => {});

  console.warn(`[${source}] ⏭️ SSOT auto-skip: ${stepKey} for ${packageId.slice(0, 8)} — ${check.reason}`);
  return true;
}

/** Clear the per-scan track cache (call at the start of each stuck-scan cycle) */
export function clearTrackCache() {
  _trackCache.clear();
}
