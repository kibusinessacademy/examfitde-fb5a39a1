/**
 * stuck-scan: Hot-Loop Detection & Auto-Mitigation
 *
 * Detects jobs cycling rapidly (fail→retry→fail or complete→re-enqueue→complete)
 * without making actual progress. Different from escalation detection (which uses
 * step attempt counts) — this uses time-windowed frequency analysis on job_queue.
 *
 * Detection signals:
 *  1) High churn: same (package_id, job_type) completed/failed N+ times in window
 *  2) No artifact delta: step meta shows no progress between cycles
 *  3) Rapid re-enqueue: new pending job created within seconds of last completion
 *
 * Mitigations (escalating):
 *  - Level 1 (warn):   Log + admin notification
 *  - Level 2 (cool):   Set run_after backoff on pending jobs
 *  - Level 3 (freeze): Cancel pending jobs + block step re-dispatch
 */

import { safeRpc, type SupabaseClient } from "./stuck-scan-helpers.ts";

// ── Thresholds ──────────────────────────────────────────────────
/** Minimum completed+failed cycles in the window to trigger detection */
const HOT_LOOP_MIN_CYCLES = 4;
/** Time window for cycle counting (minutes) */
const HOT_LOOP_WINDOW_MINUTES = 60;
/** Cycles that trigger Level 2 (cooldown) */
const HOT_LOOP_COOLDOWN_THRESHOLD = 6;
/** Cycles that trigger Level 3 (freeze) */
const HOT_LOOP_FREEZE_THRESHOLD = 10;
/** Cooldown backoff (minutes) applied at Level 2 */
const HOT_LOOP_COOLDOWN_MINUTES = 30;
/** Freeze backoff (minutes) applied at Level 3 */
const HOT_LOOP_FREEZE_MINUTES = 120;
/** Don't re-detect a loop that was already handled within this window */
const DEDUPE_WINDOW_MINUTES = 120;

export interface HotLoopResult {
  package_id: string;
  job_type: string;
  cycles: number;
  level: "warn" | "cooldown" | "freeze";
  action: string;
}

export async function detectAndMitigateHotLoops(
  sb: SupabaseClient,
): Promise<HotLoopResult[]> {
  const results: HotLoopResult[] = [];

  try {
    const windowStart = new Date(
      Date.now() - HOT_LOOP_WINDOW_MINUTES * 60_000,
    ).toISOString();

    // ── 1) Find high-churn (package_id, job_type) combos ──
    // We query recent completed + failed jobs and count per group.
    // Supabase JS doesn't support GROUP BY, so we use RPC or raw aggregation.
    // Fallback: fetch recent terminal jobs and count in-memory.
    const { data: recentTerminal } = await sb
      .from("job_queue")
      .select("id, package_id, job_type, status, completed_at, updated_at, meta")
      .in("status", ["completed", "failed"])
      .gte("updated_at", windowStart)
      .not("package_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1000);

    if (!recentTerminal || recentTerminal.length === 0) return results;

    // Count cycles per (package_id, job_type)
    const cycleMap = new Map<string, { count: number; package_id: string; job_type: string; failCount: number }>();
    for (const job of recentTerminal) {
      const key = `${job.package_id}::${job.job_type}`;
      const entry = cycleMap.get(key) ?? {
        count: 0,
        package_id: job.package_id,
        job_type: job.job_type,
        failCount: 0,
      };
      entry.count++;
      if (job.status === "failed") entry.failCount++;
      cycleMap.set(key, entry);
    }

    // Filter to hot-loop candidates
    const candidates = [...cycleMap.values()].filter(
      (c) => c.count >= HOT_LOOP_MIN_CYCLES,
    );

    if (candidates.length === 0) return results;

    // ── DM2: Track completed_job_count on step meta for no-progress detection ──
    for (const cand of candidates) {
      const stepKey = jobTypeToStepKey(cand.job_type);
      if (!stepKey) continue;
      try {
        const { data: stepRow } = await sb
          .from("package_steps")
          .select("meta, status")
          .eq("package_id", cand.package_id)
          .eq("step_key", stepKey)
          .maybeSingle();
        if (!stepRow || stepRow.status === "done" || stepRow.status === "skipped") continue;
        const meta = (stepRow.meta ?? {}) as Record<string, unknown>;
        const prevCount = (meta.completed_job_count as number) ?? 0;
        if (cand.count > prevCount) {
          await sb
            .from("package_steps")
            .update({
              meta: { ...meta, completed_job_count: cand.count, completed_job_count_at: new Date().toISOString() },
            })
            .eq("package_id", cand.package_id)
            .eq("step_key", stepKey);
        }
      } catch (_e) { /* best-effort */ }
    }

    // ── 2) For each candidate, check if there's actual progress ──
    for (const cand of candidates) {
      // Check if we already handled this loop recently (dedupe)
      const dedupeKey = `hot_loop::${cand.package_id}::${cand.job_type}`;
      const dedupeSince = new Date(
        Date.now() - DEDUPE_WINDOW_MINUTES * 60_000,
      ).toISOString();
      const { count: recentActions } = await sb
        .from("auto_heal_log")
        .select("id", { count: "exact", head: true })
        .eq("action_type", "hot_loop_mitigation")
        .eq("target_id", cand.package_id)
        .gte("created_at", dedupeSince);

      if ((recentActions ?? 0) > 0) continue;

      // Check for progress signal: did the step meta change meaningfully?
      const hasProgress = await checkStepProgress(sb, cand.package_id, cand.job_type);
      if (hasProgress) continue; // Real work happening — not a hot loop

      // ── DM1: meta.ok=true guard — if the step already has a success signal,
      // the finalization bridge should handle it, NOT the hot-loop freezer.
      // Freezing a step with meta.ok=true causes ghost-completion stalls.
      const stepKeyForOk = jobTypeToStepKey(cand.job_type);
      if (stepKeyForOk) {
        const { data: okCheck } = await sb
          .from("package_steps")
          .select("meta")
          .eq("package_id", cand.package_id)
          .eq("step_key", stepKeyForOk)
          .maybeSingle();
        const okMeta = (okCheck?.meta ?? {}) as Record<string, unknown>;
        if (okMeta.ok === true || okMeta.batch_complete === true) {
          console.log(`[stuck-scan] 🛡️ Hot-loop guard SKIPPED for ${cand.job_type}/${cand.package_id.slice(0, 8)}: meta.ok=true — deferring to finalization bridge`);
          continue;
        }
      }

      // ── 3) Determine severity level ──
      const level: HotLoopResult["level"] =
        cand.count >= HOT_LOOP_FREEZE_THRESHOLD
          ? "freeze"
          : cand.count >= HOT_LOOP_COOLDOWN_THRESHOLD
            ? "cooldown"
            : "warn";

      // ── 4) Apply mitigation ──
      let action = "";

      if (level === "warn") {
        action = `Warned: ${cand.count} cycles detected, monitoring`;
      } else if (level === "cooldown") {
        // Set backoff on pending jobs for this combo
        const backoffUntil = new Date(
          Date.now() + HOT_LOOP_COOLDOWN_MINUTES * 60_000,
        ).toISOString();
        const { count: cooledDown } = await sb
          .from("job_queue")
          .update({
            run_after: backoffUntil,
            meta: { hot_loop_cooldown: true, cooldown_until: backoffUntil, cycles: cand.count },
          } as any)
          .eq("package_id", cand.package_id)
          .eq("job_type", cand.job_type)
          .eq("status", "pending")
          .select("id", { count: "exact", head: true });

        action = `Cooldown ${HOT_LOOP_COOLDOWN_MINUTES}min applied to ${cooledDown ?? 0} pending jobs`;
      } else {
        // Freeze: cancel pending jobs entirely
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: cand.package_id,
          p_job_type: cand.job_type,
          p_statuses: ["pending"],
          p_reason: `hot-loop freeze: ${cand.count} cycles without progress`,
        });

        // Mark step with freeze metadata
        const stepKey = jobTypeToStepKey(cand.job_type);
        if (stepKey) {
          const { data: stepRow } = await sb
            .from("package_steps")
            .select("meta")
            .eq("package_id", cand.package_id)
            .eq("step_key", stepKey)
            .maybeSingle();

          if (stepRow) {
            const meta = (stepRow.meta ?? {}) as Record<string, unknown>;
            await sb
              .from("package_steps")
              .update({
                meta: {
                  ...meta,
                  hot_loop_frozen: true,
                  hot_loop_frozen_at: new Date().toISOString(),
                  hot_loop_cycles: cand.count,
                  hot_loop_fail_count: cand.failCount,
                },
                last_error: `hot-loop: ${cand.count} cycles without progress → frozen for ${HOT_LOOP_FREEZE_MINUTES}min`,
              })
              .eq("package_id", cand.package_id)
              .eq("step_key", stepKey);
          }
        }

        action = `Frozen: cancelled pending jobs + step blocked after ${cand.count} cycles`;
      }

      // ── 5) Log + notify ──
      await sb.from("auto_heal_log").insert({
        action_type: "hot_loop_mitigation",
        trigger_source: "stuck-scan",
        target_type: "job_queue",
        target_id: cand.package_id,
        result_status: level === "warn" ? "detected" : "applied",
        result_detail: action,
        metadata: {
          job_type: cand.job_type,
          cycles: cand.count,
          fail_count: cand.failCount,
          level,
          window_minutes: HOT_LOOP_WINDOW_MINUTES,
        },
      });

      if (level !== "warn") {
        const shortId = cand.package_id.slice(0, 8);
        await sb.from("admin_notifications").insert({
          title: `🔥 Hot-Loop ${level === "freeze" ? "FROZEN" : "Cooldown"}: ${cand.job_type} – ${shortId}`,
          body:
            `${cand.count} Zyklen in ${HOT_LOOP_WINDOW_MINUTES}min ohne Fortschritt erkannt. ` +
            `${cand.failCount} davon fehlgeschlagen. ${action}`,
          category: "ops",
          severity: level === "freeze" ? "critical" : "warning",
          entity_type: "package",
          entity_id: cand.package_id,
          metadata: {
            kind: "hot_loop",
            job_type: cand.job_type,
            cycles: cand.count,
            level,
          },
        });
      }

      results.push({
        package_id: cand.package_id,
        job_type: cand.job_type,
        cycles: cand.count,
        level,
        action,
      });

      console.warn(
        `[stuck-scan] 🔥 Hot-loop ${level}: ${cand.job_type} for ${cand.package_id.slice(0, 8)} — ${cand.count} cycles → ${action}`,
      );
    }
  } catch (e) {
    console.error(
      `[stuck-scan] Hot-loop detection error: ${(e as Error).message}`,
    );
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Check if the step associated with a job_type made real progress recently */
async function checkStepProgress(
  sb: SupabaseClient,
  packageId: string,
  jobType: string,
): Promise<boolean> {
  const stepKey = jobTypeToStepKey(jobType);
  if (!stepKey) return false;

  const { data: step } = await sb
    .from("package_steps")
    .select("meta, updated_at, status")
    .eq("package_id", packageId)
    .eq("step_key", stepKey)
    .maybeSingle();

  if (!step) return false;

  // If the step is already done/skipped, no loop
  if (step.status === "done" || step.status === "skipped") return true;

  const meta = (step.meta ?? {}) as Record<string, unknown>;

  // Check for progress delta indicators
  const lastProgressAt = meta.last_progress_at as string | undefined;
  if (lastProgressAt) {
    const progressAge = Date.now() - new Date(lastProgressAt).getTime();
    // Progress within the last 15 minutes = real work
    if (progressAge < 15 * 60_000) return true;
  }

  // Check for content_version writes (artifact truth)
  const recentCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { count: recentWrites } = await sb
    .from("content_versions" as any)
    .select("id", { count: "exact", head: true })
    .eq("package_id", packageId)
    .gte("created_at", recentCutoff);

  if ((recentWrites ?? 0) > 0) return true;

  return false;
}

/** Reverse lookup: job_type → step_key */
function jobTypeToStepKey(jobType: string): string | null {
  // Import would create circular dep, so inline the reverse mapping
  const map: Record<string, string> = {
    package_scaffold_learning_course: "scaffold_learning_course",
    package_generate_glossary: "generate_glossary",
    package_fanout_learning_content: "fanout_learning_content",
    package_generate_learning_content: "generate_learning_content",
    package_finalize_learning_content: "finalize_learning_content",
    package_validate_learning_content: "validate_learning_content",
    package_auto_seed_exam_blueprints: "auto_seed_exam_blueprints",
    package_validate_blueprints: "validate_blueprints",
    package_generate_exam_pool: "generate_exam_pool",
    package_validate_exam_pool: "validate_exam_pool",
    package_repair_exam_pool_quality: "repair_exam_pool_quality",
    package_build_ai_tutor_index: "build_ai_tutor_index",
    package_validate_tutor_index: "validate_tutor_index",
    package_generate_oral_exam: "generate_oral_exam",
    package_validate_oral_exam: "validate_oral_exam",
    package_generate_lesson_minichecks: "generate_lesson_minichecks",
    package_validate_lesson_minichecks: "validate_lesson_minichecks",
    package_generate_handbook: "generate_handbook",
    package_validate_handbook: "validate_handbook",
    package_enqueue_handbook_expand: "enqueue_handbook_expand",
    handbook_expand_section: "expand_handbook",
    package_validate_handbook_depth: "validate_handbook_depth",
    package_elite_harden: "elite_harden",
    package_run_integrity_check: "run_integrity_check",
    package_quality_council: "quality_council",
    package_auto_publish: "auto_publish",
  };
  return map[jobType] ?? null;
}
