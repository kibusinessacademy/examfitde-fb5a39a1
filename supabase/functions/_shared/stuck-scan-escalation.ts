/**
 * stuck-scan: Escalation loop detection + system freeze detection.
 */
import { STEP_TO_JOB_TYPE } from "./job-map.ts";
import { safeRpc, type SupabaseClient } from "./stuck-scan-helpers.ts";

const ESCALATION_MAX = 10;
const MULTI_BATCH_STEPS = new Set([
  "generate_learning_content", "generate_exam_pool",
  "generate_lesson_minichecks", "generate_oral_exam", "generate_handbook",
]);

export async function detectEscalationLoops(sb: SupabaseClient) {
  const { data: escalatedSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, attempts, status, updated_at, last_error, meta")
    .gte("attempts", ESCALATION_MAX)
    .not("status", "in", '("done","skipped","blocked")');

  const escalationResults: Array<{ package_id: string; step_key: string; action: string }> = [];

  for (const es of escalatedSteps || []) {
    if (MULTI_BATCH_STEPS.has(es.step_key)) {
      const jobType = STEP_TO_JOB_TYPE[es.step_key] ?? null;
      if (jobType) {
        const recentCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count: recentCompletions } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .eq("job_type", jobType).eq("status", "completed")
          .gte("completed_at", recentCutoff);
        if ((recentCompletions ?? 0) > 0) continue;
      }
    }

    const updatedAt = es.updated_at ? new Date(es.updated_at).getTime() : 0;
    const ageMs = updatedAt > 0 ? (Date.now() - updatedAt) : Infinity;
    if (ageMs < 10 * 60 * 1000) continue;

    const lastErr = String(es.last_error || "");
    const metaErr = String(((es.meta ?? {}) as Record<string, unknown>)?.error || "");
    if (!lastErr && !metaErr) continue;

    const isValidation = es.step_key.startsWith("validate_");
    const jobType = STEP_TO_JOB_TYPE[es.step_key] ?? null;

    if (isValidation) {
      await sb.from("package_steps").update({
        status: "skipped", finished_at: new Date().toISOString(),
        last_error: `stuck-scan: escalation breaker after ${es.attempts} attempts`,
      }).eq("package_id", es.package_id).eq("step_key", es.step_key);

      await safeRpc(sb, "cancel_jobs_for_package", {
        p_package_id: es.package_id, p_job_type: jobType,
        p_statuses: ["pending", "failed"],
        p_reason: `stuck-scan escalation breaker: skip ${es.step_key}`,
      });

      escalationResults.push({ package_id: es.package_id, step_key: es.step_key, action: "skipped (validation loop)" });
      console.warn(`[stuck-scan] 🛑 Escalation breaker: skipped ${es.step_key} for ${es.package_id.slice(0, 8)} after ${es.attempts} attempts`);
    } else {
      await sb.from("course_packages").update({
        stuck_reason: `Escalation loop: step ${es.step_key} has ${es.attempts} attempts — manual review required`,
      }).eq("id", es.package_id);

      await safeRpc(sb, "cancel_jobs_for_package", {
        p_package_id: es.package_id, p_job_type: jobType,
        p_statuses: ["pending", "failed"],
        p_reason: `stuck-scan escalation breaker: halt ${es.step_key}`,
      });

      escalationResults.push({ package_id: es.package_id, step_key: es.step_key, action: "flagged for manual review (non-validation)" });
      console.warn(`[stuck-scan] 🛑 Escalation: ${es.step_key} for ${es.package_id.slice(0, 8)} flagged for manual review after ${es.attempts} attempts`);
    }
  }

  return escalationResults;
}

export async function detectSystemFreeze(sb: SupabaseClient): Promise<boolean> {
  const FREEZE_MINUTES = 120;
  const ACTIVE_STALL_MINUTES = 20;
  const nowIso = new Date().toISOString();

  const { data: lastCompleted } = await sb
    .from("job_queue").select("completed_at")
    .eq("status", "completed").not("completed_at", "is", null)
    .order("completed_at", { ascending: false }).limit(1);

  const { count: processingCnt } = await sb
    .from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing");

  const { count: readyPendingCnt } = await sb
    .from("job_queue").select("id", { count: "exact", head: true })
    .eq("status", "pending").or(`run_after.is.null,run_after.lte.${nowIso}`);

  const { data: lastActive } = await sb
    .from("job_queue").select("updated_at")
    .in("status", ["pending", "queued", "processing"])
    .order("updated_at", { ascending: false }).limit(1);

  const activeCnt = (processingCnt ?? 0) + (readyPendingCnt ?? 0);
  const lastCompletedAt = lastCompleted?.[0]?.completed_at
    ? new Date(lastCompleted[0].completed_at as string).getTime() : 0;
  const lastActiveAt = lastActive?.[0]?.updated_at
    ? new Date(lastActive[0].updated_at as string).getTime() : 0;

  const freezeCutoff = Date.now() - FREEZE_MINUTES * 60_000;
  const activityCutoff = Date.now() - ACTIVE_STALL_MINUTES * 60_000;
  const isFrozen =
    activeCnt > 0 &&
    (lastCompletedAt === 0 || lastCompletedAt < freezeCutoff) &&
    (lastActiveAt === 0 || lastActiveAt < activityCutoff);

  if (isFrozen) {
    const dedupeTitle = `⚫ System-Freeze: keine completed Jobs seit ${FREEZE_MINUTES}min`;
    const dedupeSince = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: existing } = await sb
      .from("admin_notifications").select("id", { count: "exact", head: true })
      .eq("category", "ops").eq("title", dedupeTitle).gte("created_at", dedupeSince);
    if ((existing ?? 0) === 0) {
      await sb.from("admin_notifications").insert({
        title: dedupeTitle,
        body: `Ready-Queue/Processing aktiv (${activeCnt}), aber kein Completion seit >${FREEZE_MINUTES} Min und keine Queue-Aktivität seit >${ACTIVE_STALL_MINUTES} Min. Prüfe Runner + Lease-Hygiene.`,
        category: "ops", severity: "error",
        metadata: {
          dedupe_key: `system_freeze_${new Date().toISOString().slice(0, 13)}`,
          active_jobs: activeCnt, processing: processingCnt ?? 0,
          ready_pending: readyPendingCnt ?? 0,
          last_completed_at: lastCompleted?.[0]?.completed_at ?? null,
          last_active_at: lastActive?.[0]?.updated_at ?? null,
        },
      });
    }
  }

  return isFrozen;
}
