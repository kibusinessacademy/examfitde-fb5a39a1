/**
 * stuck-scan: Orphan processing, enqueued-drift, and status-lag self-heal.
 */
import { STEP_TO_JOB_TYPE } from "./job-map.ts";
import type { SupabaseClient } from "./stuck-scan-helpers.ts";

const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
const ENQ_DRIFT_MIN_AGE_MS = 10 * 60 * 1000;

export async function healOrphanProcessing(sb: SupabaseClient) {
  const orphanResults: Array<{ package_id: string; step_key: string; action: string }> = [];

  const { data: processingSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, started_at, attempts, meta, status")
    .eq("status", "running")
    .limit(500);

  for (const ps of processingSteps || []) {
    const jobType = STEP_TO_JOB_TYPE[ps.step_key] ?? null;
    if (!jobType) continue;

    const ageMs = ps.started_at ? Date.now() - new Date(ps.started_at).getTime() : null;
    const isGhostProcessing = !ps.started_at;
    if (isGhostProcessing && (ps.attempts || 0) === 0) continue;
    if (ageMs !== null && ageMs <= ORPHAN_MIN_AGE_MS) continue;

    const { count: activeJobCnt } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("package_id", ps.package_id)
      .eq("job_type", jobType)
      .in("status", ["pending", "queued", "processing"]);
    if ((activeJobCnt ?? 0) > 0) continue;

    const prevMeta = (ps.meta ?? {}) as Record<string, unknown>;
    const stallCount = Number(prevMeta.stall_count ?? 0) + 1;
    const newAttempts = (ps.attempts || 0) + 1;
    const ageMin = ageMs !== null ? Math.round(ageMs / 60000) : 0;

    await sb.from("package_steps").update({
      status: "queued", started_at: null, finished_at: null, attempts: newAttempts,
      meta: {
        ...prevMeta, stall_count: stallCount,
        last_progress_note: `orphan-heal: processing>${ageMin}min, no active jobs`,
        orphan_healed_at: new Date().toISOString(),
      },
    }).eq("package_id", ps.package_id).eq("step_key", ps.step_key);

    await sb.from("auto_heal_log").insert({
      action_type: "orphan_processing_self_heal", trigger_source: "stuck-scan",
      target_type: "package_step", target_id: ps.package_id, result_status: "applied",
      result_detail: `Step ${ps.step_key} was processing for ${ageMin}min with 0 active jobs — reset to queued (attempt ${newAttempts}, stall ${stallCount})`,
      metadata: { step_key: ps.step_key, age_min: ageMin, stall_count: stallCount },
    });

    orphanResults.push({ package_id: ps.package_id, step_key: ps.step_key, action: `orphan-heal: reset to queued (${ageMin}min stale)` });
    console.warn(`[stuck-scan] 🧟‍♂️ Orphan-heal: ${ps.step_key} for ${ps.package_id.slice(0,8)} — processing ${ageMin}min, no jobs → queued`);
  }

  if (orphanResults.length > 0) {
    console.log(`[stuck-scan] 🧟‍♂️ Self-healed ${orphanResults.length} orphan-processing step(s)`);
  }

  return orphanResults;
}

export async function healEnqueuedDrift(sb: SupabaseClient) {
  const enqueuedDriftResults: Array<{ package_id: string; step_key: string; action: string }> = [];

  const { data: enqSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, updated_at, attempts, meta, status")
    .eq("status", "enqueued")
    .limit(500);

  for (const ps of enqSteps || []) {
    const ageMs = Date.now() - new Date(ps.updated_at).getTime();
    if (ageMs <= ENQ_DRIFT_MIN_AGE_MS) continue;

    const jobType = STEP_TO_JOB_TYPE[ps.step_key] ?? null;
    if (!jobType) continue;

    const { count: activeCnt, error: jobErr } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("package_id", ps.package_id)
      .eq("job_type", jobType)
      .in("status", ["pending", "queued", "processing"]);

    if (jobErr) { console.error(`[stuck-scan] enqueued-drift job check error: ${jobErr.message}`); continue; }
    if ((activeCnt ?? 0) > 0) continue;

    const prevMeta = (ps.meta ?? {}) as Record<string, unknown>;
    const ageMin = Math.round(ageMs / 60000);

    await sb.from("package_steps").update({
      status: "queued",
      meta: {
        ...prevMeta,
        last_progress_note: `enqueued-drift-heal: no active job for ${ageMin}min`,
        enqueued_healed_at: new Date().toISOString(),
      },
    }).eq("package_id", ps.package_id).eq("step_key", ps.step_key);

    await sb.from("auto_heal_log").insert({
      action_type: "enqueued_drift_self_heal", trigger_source: "stuck-scan",
      target_type: "package_step", target_id: ps.package_id, result_status: "applied",
      result_detail: `Step ${ps.step_key} enqueued ${ageMin}min with 0 active jobs — reset to queued`,
      metadata: { step_key: ps.step_key, age_min: ageMin },
    });

    enqueuedDriftResults.push({ package_id: ps.package_id, step_key: ps.step_key, action: `enqueued-drift-heal: reset to queued (${ageMin}min stale)` });
    console.warn(`[stuck-scan] 📭 Enqueued-drift-heal: ${ps.step_key} for ${ps.package_id.slice(0,8)} — enqueued ${ageMin}min, no jobs → queued`);
  }

  if (enqueuedDriftResults.length > 0) {
    console.log(`[stuck-scan] 📭 Self-healed ${enqueuedDriftResults.length} enqueued-drift step(s)`);
  }

  return enqueuedDriftResults;
}

export async function healStatusLag(sb: SupabaseClient) {
  const statusLagResults: Array<{ package_id: string; step_key: string }> = [];

  const { data: lagSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, meta")
    .eq("status", "enqueued")
    .limit(500);

  for (const ps of lagSteps || []) {
    const jobType = STEP_TO_JOB_TYPE[ps.step_key] ?? null;
    if (!jobType) continue;

    const { count: procCnt } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("package_id", ps.package_id)
      .eq("job_type", jobType)
      .eq("status", "processing");

    if ((procCnt ?? 0) === 0) continue;

    const prevMeta = (ps.meta ?? {}) as Record<string, unknown>;
    await sb.from("package_steps").update({
      status: "running", started_at: new Date().toISOString(),
      meta: {
        ...prevMeta,
        last_progress_note: "status-lag-heal: job processing -> step running",
        status_lag_healed_at: new Date().toISOString(),
      },
    }).eq("package_id", ps.package_id).eq("step_key", ps.step_key);

    await sb.from("auto_heal_log").insert({
      action_type: "status_lag_self_heal", trigger_source: "stuck-scan",
      target_type: "package_step", target_id: ps.package_id, result_status: "applied",
      result_detail: `Step ${ps.step_key} was enqueued but job ${jobType} is processing -> step set to running`,
      metadata: { step_key: ps.step_key, job_type: jobType },
    });

    statusLagResults.push({ package_id: ps.package_id, step_key: ps.step_key });
  }

  if (statusLagResults.length > 0) {
    console.log(`[stuck-scan] 🧷 Status-lag healed ${statusLagResults.length} step(s)`);
  }

  return statusLagResults;
}

const BATCH_COMPLETE_MIN_AGE_MS = 15 * 60 * 1000;

/**
 * Detect steps that are "queued" but their meta indicates batch_complete=true
 * and no active jobs remain. Transition them to "done".
 */
export async function healBatchCompleteStuck(sb: SupabaseClient) {
  const results: Array<{ package_id: string; step_key: string; action: string }> = [];

  const { data: stuckSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, updated_at, meta, attempts")
    .eq("status", "queued")
    .limit(500);

  for (const ps of stuckSteps || []) {
    const meta = (ps.meta ?? {}) as Record<string, unknown>;
    if (!meta.batch_complete) continue;
    if (meta.needs_regen && Number(meta.needs_regen) > 0) continue;

    const ageMs = Date.now() - new Date(ps.updated_at).getTime();
    if (ageMs < BATCH_COMPLETE_MIN_AGE_MS) continue;

    const jobType = STEP_TO_JOB_TYPE[ps.step_key] ?? null;
    if (jobType) {
      const { count: activeCnt } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("package_id", ps.package_id)
        .eq("job_type", jobType)
        .in("status", ["pending", "queued", "processing"]);
      if ((activeCnt ?? 0) > 0) continue;
    }

    await sb.from("package_steps").update({
      status: "done",
      finished_at: new Date().toISOString(),
      meta: {
        ...meta,
        postcondition_verified: true,
        batch_complete_heal: true,
        batch_complete_healed_at: new Date().toISOString(),
      },
    }).eq("package_id", ps.package_id).eq("step_key", ps.step_key);

    await sb.from("auto_heal_log").insert({
      action_type: "batch_complete_stuck_heal",
      trigger_source: "stuck-scan",
      target_type: "package_step",
      target_id: ps.package_id,
      result_status: "applied",
      result_detail: `Step ${ps.step_key} was queued with batch_complete=true for ${Math.round(ageMs / 60000)}min — set to done`,
      metadata: { step_key: ps.step_key, age_min: Math.round(ageMs / 60000) },
    });

    results.push({ package_id: ps.package_id, step_key: ps.step_key, action: "batch-complete-heal: queued→done" });
    console.warn(`[stuck-scan] 🔄 Batch-complete-heal: ${ps.step_key} for ${ps.package_id.slice(0, 8)} — queued with batch_complete=true → done`);
  }

  if (results.length > 0) {
    console.log(`[stuck-scan] 🔄 Batch-complete healed ${results.length} step(s)`);
  }

  return results;
}
