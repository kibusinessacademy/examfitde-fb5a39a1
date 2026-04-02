/**
 * stuck-scan: Endless Requeue Loop Detection & Mitigation
 *
 * Detects jobs/steps that cycle through:
 *   pending → processing → (worker returns retry/transient) → pending → ...
 * without ever reaching a terminal state (completed/failed) and without
 * triggering stale-lock recovery (the worker responds normally, just retries).
 *
 * This is distinct from:
 *  - Hot-loop: catches completed/failed terminal churn
 *  - Stale-lock loop: catches STALE_LOCK_RECOVERY markers
 *
 * Detection signals:
 *  1) High attempt count on still-pending/processing jobs (no terminal state reached)
 *  2) Step meta shows repeated transient_attempts without progress
 *  3) Same (package_id, job_type) has been pending→processing→pending many times
 *
 * Mitigations (escalating):
 *  - Level 1 (warn, ≥5 attempts):    Log + admin notification
 *  - Level 2 (cooldown, ≥8 attempts): Exponential backoff via run_after
 *  - Level 3 (kill, ≥12 attempts):    Fail job + flag package for review
 */

import { type SupabaseClient } from "./stuck-scan-helpers.ts";

// ── Thresholds ──────────────────────────────────────────────────
const REQUEUE_WARN_ATTEMPTS = 5;
const REQUEUE_COOLDOWN_ATTEMPTS = 8;
const REQUEUE_KILL_ATTEMPTS = 12;
const COOLDOWN_BASE_MINUTES = 10;
const DEDUPE_WINDOW_MINUTES = 120;

export interface RequeueLoopResult {
  job_id: string;
  package_id: string;
  job_type: string;
  attempts: number;
  max_attempts: number;
  level: "warn" | "cooldown" | "kill";
  action: string;
}

export async function detectAndMitigateRequeueLoops(
  sb: SupabaseClient,
): Promise<RequeueLoopResult[]> {
  const results: RequeueLoopResult[] = [];

  try {
    // ── 1) Find jobs with high attempt counts still active ──
    // Exclude stale-lock markers (handled by stale-lock-loop detector)
    const { data: candidates } = await sb
      .from("job_queue")
      .select("id, package_id, job_type, status, attempts, max_attempts, last_error, meta, updated_at, run_after")
      .in("status", ["pending", "processing"])
      .gte("attempts", REQUEUE_WARN_ATTEMPTS)
      .not("package_id", "is", null)
      .order("attempts", { ascending: false })
      .limit(200);

    if (!candidates || candidates.length === 0) return results;

    // Filter out stale-lock jobs (already handled by that detector)
    const filtered = candidates.filter((j: any) => {
      const err = String(j.last_error ?? "");
      return !err.includes("STALE_LOCK_RECOVERY") && !err.includes("STALE_LOCK_LOOP");
    });

    if (filtered.length === 0) return results;

    for (const job of filtered) {
      const attempts = job.attempts ?? 0;
      const maxAttempts = job.max_attempts ?? 8;

      // Dedupe: skip if we already acted on this job recently
      const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000).toISOString();
      const { count: recentActions } = await sb
        .from("auto_heal_log")
        .select("id", { count: "exact", head: true })
        .eq("action_type", "requeue_loop_mitigation")
        .eq("target_id", job.id)
        .gte("created_at", dedupeSince);

      if ((recentActions ?? 0) > 0) continue;

      // ── 2) Check for real progress (avoid false positives) ──
      const hasProgress = await checkRecentProgress(sb, job.package_id, job.job_type);
      if (hasProgress) continue;

      // ── 3) Determine severity level ──
      const level: RequeueLoopResult["level"] =
        attempts >= REQUEUE_KILL_ATTEMPTS
          ? "kill"
          : attempts >= REQUEUE_COOLDOWN_ATTEMPTS
            ? "cooldown"
            : "warn";

      // ── 4) Apply mitigation ──
      let action = "";

      if (level === "warn") {
        action = `Warning: job ${job.id.slice(0, 8)} has ${attempts}/${maxAttempts} attempts without terminal state`;

      } else if (level === "cooldown") {
        const backoffMinutes = COOLDOWN_BASE_MINUTES * Math.pow(2, attempts - REQUEUE_COOLDOWN_ATTEMPTS);
        const cappedMinutes = Math.min(backoffMinutes, 180); // cap at 3h
        const runAfter = new Date(Date.now() + cappedMinutes * 60_000).toISOString();

        await sb.from("job_queue").update({
          status: "pending",
          run_after: runAfter,
          locked_at: null,
          locked_by: null,
          last_error: `REQUEUE_LOOP_COOLDOWN: ${attempts} attempts without completion → backoff ${Math.round(cappedMinutes)}min`,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        action = `Cooldown: ${Math.round(cappedMinutes)}min backoff after ${attempts} requeue attempts`;

      } else {
        // Kill: fail the job permanently
        await sb.from("job_queue").update({
          status: "failed",
          locked_at: null,
          locked_by: null,
          last_error: `REQUEUE_LOOP_KILLED: ${attempts} attempts without reaching terminal state — likely deterministic retry failure`,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        // Flag the package
        if (job.package_id) {
          await sb.from("course_packages").update({
            stuck_reason: `Requeue loop: job ${job.job_type} retried ${attempts}x without completing — manual review required`,
          }).eq("id", job.package_id);
        }

        action = `Killed: job failed after ${attempts} requeue attempts, package flagged for review`;
      }

      // ── 5) Log ──
      await sb.from("auto_heal_log").insert({
        action_type: "requeue_loop_mitigation",
        trigger_source: "stuck-scan",
        target_type: "job_queue",
        target_id: job.id,
        result_status: level === "warn" ? "detected" : "applied",
        result_detail: action,
        metadata: {
          package_id: job.package_id,
          job_type: job.job_type,
          attempts,
          max_attempts: maxAttempts,
          level,
          last_error: String(job.last_error ?? "").slice(0, 300),
        },
      });

      // ── 6) Admin notification for cooldown/kill ──
      if (level !== "warn") {
        const shortPkg = (job.package_id ?? "unknown").slice(0, 8);
        const shortJob = job.id.slice(0, 8);
        await sb.from("admin_notifications").insert({
          title: `🔄 Requeue-Loop ${level === "kill" ? "KILLED" : "Cooldown"}: ${job.job_type} – ${shortPkg}`,
          body:
            `Job ${shortJob} wurde ${attempts}x requeued ohne Terminal-State zu erreichen. ` +
            `${action}. Ursache prüfen: Worker-Logik, transiente Fehler oder fehlende Ressourcen.`,
          category: "ops",
          severity: level === "kill" ? "critical" : "warning",
          entity_type: "package",
          entity_id: job.package_id,
          metadata: {
            kind: "requeue_loop",
            job_id: job.id,
            job_type: job.job_type,
            attempts,
            level,
          },
        });
      }

      results.push({
        job_id: job.id,
        package_id: job.package_id,
        job_type: job.job_type,
        attempts,
        max_attempts: maxAttempts,
        level,
        action,
      });

      console.warn(
        `[stuck-scan] 🔄 Requeue-loop ${level}: ${job.job_type} job ${job.id.slice(0, 8)} — ${attempts} attempts → ${action}`,
      );
    }

    // ── 7) Step-level detection: steps with high transient_attempts ──
    await detectStepRequeueLoops(sb, results);

  } catch (e) {
    console.error(`[stuck-scan] Requeue-loop detection error: ${(e as Error).message}`);
  }

  return results;
}

/**
 * Detect steps that have accumulated many transient_attempts without progressing.
 * This catches the pattern where the step gets retried at the step level (not job level).
 */
async function detectStepRequeueLoops(
  sb: SupabaseClient,
  results: RequeueLoopResult[],
): Promise<void> {
  try {
    // Find active steps with high transient attempt counts in meta
    const { data: steps } = await sb
      .from("package_steps")
      .select("package_id, step_key, status, meta, last_error, updated_at")
      .in("status", ["queued", "running", "pending"])
      .not("meta", "is", null)
      .limit(500);

    if (!steps || steps.length === 0) return;

    for (const step of steps) {
      const meta = (step.meta ?? {}) as Record<string, unknown>;
      const transientAttempts = Number(meta.transient_attempts ?? 0);
      const hollowAttempts = Number(meta.hollow_attempts ?? 0);
      const totalRetries = transientAttempts + hollowAttempts;

      if (totalRetries < REQUEUE_WARN_ATTEMPTS) continue;

      // Skip if already frozen by hot-loop
      if (meta.hot_loop_frozen) continue;

      // Dedupe
      const dedupeKey = `${step.package_id}::${step.step_key}`;
      const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000).toISOString();
      const { count: recentActions } = await sb
        .from("auto_heal_log")
        .select("id", { count: "exact", head: true })
        .eq("action_type", "requeue_loop_step_mitigation")
        .eq("target_id", step.package_id)
        .gte("created_at", dedupeSince);

      if ((recentActions ?? 0) > 0) continue;

      const level: "warn" | "cooldown" | "kill" =
        totalRetries >= REQUEUE_KILL_ATTEMPTS
          ? "kill"
          : totalRetries >= REQUEUE_COOLDOWN_ATTEMPTS
            ? "cooldown"
            : "warn";

      let action = `Step ${step.step_key}: ${totalRetries} retries (${transientAttempts} transient, ${hollowAttempts} hollow)`;

      if (level === "kill") {
        // Mark step as failed
        await sb.from("package_steps").update({
          status: "failed",
          last_error: `REQUEUE_LOOP_KILLED: ${totalRetries} retries without progress`,
          meta: { ...meta, requeue_loop_killed: true, requeue_loop_killed_at: new Date().toISOString() },
        }).eq("package_id", step.package_id).eq("step_key", step.step_key);

        action += ` → step killed`;
      }

      await sb.from("auto_heal_log").insert({
        action_type: "requeue_loop_step_mitigation",
        trigger_source: "stuck-scan",
        target_type: "package_steps",
        target_id: step.package_id,
        result_status: level === "warn" ? "detected" : "applied",
        result_detail: action,
        metadata: {
          step_key: step.step_key,
          transient_attempts: transientAttempts,
          hollow_attempts: hollowAttempts,
          total_retries: totalRetries,
          level,
        },
      });

      if (level !== "warn") {
        const shortPkg = step.package_id.slice(0, 8);
        await sb.from("admin_notifications").insert({
          title: `🔄 Step Requeue-Loop ${level === "kill" ? "KILLED" : "Cooldown"}: ${step.step_key} – ${shortPkg}`,
          body: action,
          category: "ops",
          severity: level === "kill" ? "critical" : "warning",
          entity_type: "package",
          entity_id: step.package_id,
          metadata: { kind: "requeue_loop_step", step_key: step.step_key, total_retries: totalRetries, level },
        });
      }

      console.warn(`[stuck-scan] 🔄 Step requeue-loop ${level}: ${step.step_key} for ${step.package_id.slice(0, 8)} — ${action}`);
    }
  } catch (e) {
    console.error(`[stuck-scan] Step requeue-loop detection error: ${(e as Error).message}`);
  }
}

/** Check if the package/job_type made real progress recently */
async function checkRecentProgress(
  sb: SupabaseClient,
  packageId: string,
  _jobType: string,
): Promise<boolean> {
  try {
    // Check for recent content_version writes (artifact truth)
    const recentCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const { count: recentWrites } = await sb
      .from("content_versions" as any)
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId)
      .gte("created_at", recentCutoff);

    if ((recentWrites ?? 0) > 0) return true;

    return false;
  } catch {
    return false;
  }
}
