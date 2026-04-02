/**
 * stuck-scan: Stale-Lock Loop Detection & Mitigation
 *
 * Detects jobs that cycle repeatedly through:
 *   processing → STALE_LOCK_RECOVERY → pending → processing → ...
 * without ever completing or failing permanently.
 *
 * Unlike hot-loop detection (which watches completed/failed terminal states),
 * stale-lock loops never reach terminal state — the job stays in
 * pending↔processing limbo until attempt exhaustion.
 *
 * Detection signals:
 *  1) last_error contains "STALE_LOCK_RECOVERY" with high attempt count
 *  2) Same (package_id, job_type) has multiple active jobs with recovery markers
 *  3) No artifact progress despite repeated recoveries
 *
 * Mitigations (escalating):
 *  - Level 1 (warn, ≥3 recoveries): Log + admin notification
 *  - Level 2 (cooldown, ≥5 recoveries): Exponential backoff via run_after
 *  - Level 3 (kill, ≥7 recoveries): Fail job + flag package for review
 */

import { type SupabaseClient } from "./stuck-scan-helpers.ts";

// ── Thresholds ──────────────────────────────────────────────────
const STALE_LOCK_WARN_ATTEMPTS = 3;
const STALE_LOCK_COOLDOWN_ATTEMPTS = 5;
const STALE_LOCK_KILL_ATTEMPTS = 7;
const COOLDOWN_BACKOFF_MINUTES = 15;
const DEDUPE_WINDOW_MINUTES = 120;

export interface StaleLockLoopResult {
  job_id: string;
  package_id: string;
  job_type: string;
  attempts: number;
  level: "warn" | "cooldown" | "kill";
  action: string;
}

export async function detectAndMitigateStaleLockLoops(
  sb: SupabaseClient,
): Promise<StaleLockLoopResult[]> {
  const results: StaleLockLoopResult[] = [];

  try {
    // ── 1) Find jobs currently in stale-lock recovery cycle ──
    // These are pending/processing jobs whose last_error indicates repeated recovery
    const { data: candidates } = await sb
      .from("job_queue")
      .select("id, package_id, job_type, status, attempts, max_attempts, last_error, meta, updated_at")
      .in("status", ["pending", "processing"])
      .like("last_error", "STALE_LOCK_RECOVERY%")
      .gte("attempts", STALE_LOCK_WARN_ATTEMPTS)
      .not("package_id", "is", null)
      .order("attempts", { ascending: false })
      .limit(100);

    if (!candidates || candidates.length === 0) return results;

    for (const job of candidates) {
      const attempts = job.attempts ?? 0;

      // Dedupe: skip if we already acted on this job recently
      const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000).toISOString();
      const { count: recentActions } = await sb
        .from("auto_heal_log")
        .select("id", { count: "exact", head: true })
        .eq("action_type", "stale_lock_loop_mitigation")
        .eq("target_id", job.id)
        .gte("created_at", dedupeSince);

      if ((recentActions ?? 0) > 0) continue;

      // ── 2) Determine severity level ──
      const level: StaleLockLoopResult["level"] =
        attempts >= STALE_LOCK_KILL_ATTEMPTS
          ? "kill"
          : attempts >= STALE_LOCK_COOLDOWN_ATTEMPTS
            ? "cooldown"
            : "warn";

      // ── 3) Apply mitigation ──
      let action = "";

      if (level === "warn") {
        action = `Warning: job ${job.id.slice(0, 8)} has ${attempts} stale-lock recoveries`;

      } else if (level === "cooldown") {
        const backoffMs = COOLDOWN_BACKOFF_MINUTES * 60_000 * Math.pow(2, attempts - STALE_LOCK_COOLDOWN_ATTEMPTS);
        const cappedMs = Math.min(backoffMs, 120 * 60_000); // cap at 2h
        const runAfter = new Date(Date.now() + cappedMs).toISOString();

        await sb.from("job_queue").update({
          status: "pending",
          run_after: runAfter,
          locked_at: null,
          locked_by: null,
          last_error: `STALE_LOCK_LOOP_COOLDOWN: ${attempts} recoveries → backoff ${Math.round(cappedMs / 60_000)}min`,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        action = `Cooldown: backoff ${Math.round(cappedMs / 60_000)}min applied after ${attempts} recoveries`;

      } else {
        // Kill: fail the job permanently and flag the package
        await sb.from("job_queue").update({
          status: "failed",
          locked_at: null,
          locked_by: null,
          last_error: `STALE_LOCK_LOOP_KILLED: ${attempts} recoveries without completion — likely systematic failure`,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        // Flag the package for manual review
        if (job.package_id) {
          await sb.from("course_packages").update({
            stuck_reason: `Stale-lock loop: job ${job.job_type} recovered ${attempts}x without completing — manual review required`,
          }).eq("id", job.package_id);
        }

        action = `Killed: job failed after ${attempts} stale-lock recoveries, package flagged for review`;
      }

      // ── 4) Log ──
      await sb.from("auto_heal_log").insert({
        action_type: "stale_lock_loop_mitigation",
        trigger_source: "stuck-scan",
        target_type: "job_queue",
        target_id: job.id,
        result_status: level === "warn" ? "detected" : "applied",
        result_detail: action,
        metadata: {
          package_id: job.package_id,
          job_type: job.job_type,
          attempts,
          max_attempts: job.max_attempts,
          level,
        },
      });

      // ── 5) Admin notification for cooldown/kill ──
      if (level !== "warn") {
        const shortPkg = (job.package_id ?? "unknown").slice(0, 8);
        const shortJob = job.id.slice(0, 8);
        await sb.from("admin_notifications").insert({
          title: `🔒 Stale-Lock Loop ${level === "kill" ? "KILLED" : "Cooldown"}: ${job.job_type} – ${shortPkg}`,
          body:
            `Job ${shortJob} wurde ${attempts}x durch Stale-Lock-Recovery recycelt ohne Completion. ` +
            `${action}. Mögliche Ursache: Worker-Crash, Timeout oder systematischer Fehler.`,
          category: "ops",
          severity: level === "kill" ? "critical" : "warning",
          entity_type: "package",
          entity_id: job.package_id,
          metadata: {
            kind: "stale_lock_loop",
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
        level,
        action,
      });

      console.warn(
        `[stuck-scan] 🔒 Stale-lock loop ${level}: ${job.job_type} job ${job.id.slice(0, 8)} — ${attempts} recoveries → ${action}`,
      );
    }
  } catch (e) {
    console.error(`[stuck-scan] Stale-lock loop detection error: ${(e as Error).message}`);
  }

  return results;
}
