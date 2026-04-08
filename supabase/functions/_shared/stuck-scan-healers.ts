/**
 * stuck-scan: Orphan processing, enqueued-drift, and status-lag self-heal.
 */
import { STEP_TO_JOB_TYPE } from "./job-map.ts";
import { markStepDone } from "./steps.ts";
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

const META_COMPLETE_MIN_AGE_MS = 15 * 60 * 1000;

/**
 * Detect steps that are "queued"/"running"/"enqueued" but their meta indicates
 * completion (batch_complete=true OR ok=true) and no active jobs remain.
 * Transition them to "done" via markStepDone (SSOT postcondition gate).
 *
 * This is the systemic fix for "finalization bridge gap": the pipeline-process
 * finalization bridge only runs when a job for the package is being processed.
 * If all jobs are DAG-blocked or completed, the bridge never fires.
 */
export async function healBatchCompleteStuck(sb: SupabaseClient) {
  const results: Array<{ package_id: string; step_key: string; action: string }> = [];

  // Fetch steps that are NOT terminal but have completion signals in meta
  const { data: stuckSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, updated_at, meta, attempts")
    .in("status", ["queued", "running", "enqueued"])
    .limit(500);

  for (const ps of stuckSteps || []) {
    const meta = (ps.meta ?? {}) as Record<string, unknown>;

    // ── Completion signal check: batch_complete OR ok ──
    const hasBatchComplete = meta.batch_complete === true;
    const hasMetaOk = meta.ok === true;
    if (!hasBatchComplete && !hasMetaOk) continue;

    // Skip if still flagged for regeneration
    if (meta.needs_regen && Number(meta.needs_regen) > 0) continue;

    const ageMs = Date.now() - new Date(ps.updated_at).getTime();
    if (ageMs < META_COMPLETE_MIN_AGE_MS) continue;

    // Check no active jobs for this step
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

    // ── SSOT POSTCONDITION GATE ──
    const ageMin = Math.round(ageMs / 60000);
    const signal = hasBatchComplete ? "batch_complete" : "meta.ok";
    try {
      await markStepDone(sb, {
        packageId: ps.package_id,
        stepKey: ps.step_key,
        meta: {
          ...meta,
          meta_complete_heal: true,
          meta_complete_signal: signal,
          meta_complete_healed_at: new Date().toISOString(),
        },
      });

      await sb.from("auto_heal_log").insert({
        action_type: "batch_complete_stuck_heal",
        trigger_source: "stuck-scan",
        target_type: "package_step",
        target_id: ps.package_id,
        result_status: "applied",
        result_detail: `Step ${ps.step_key} was ${ps.status} with ${signal}=true for ${ageMin}min — postconditions PASSED → done`,
        metadata: { step_key: ps.step_key, age_min: ageMin, signal },
      });

      results.push({ package_id: ps.package_id, step_key: ps.step_key, action: `meta-complete-heal: ${ps.status}→done (${signal}, postcondition-verified)` });
      console.warn(`[stuck-scan] 🔄 Meta-complete-heal: ${ps.step_key} for ${ps.package_id.slice(0, 8)} — ${signal}=true, postconditions PASSED → done`);
    } catch (pcErr: unknown) {
      // Postconditions failed — content is hollow. Do NOT promote to done.
      const errMsg = pcErr instanceof Error ? pcErr.message : String(pcErr);
      const errMeta = (pcErr as any)?.__meta ?? {};
      console.warn(`[stuck-scan] 🚫 Meta-complete-heal BLOCKED for ${ps.step_key}/${ps.package_id.slice(0, 8)}: postcondition failed — ${errMsg}`);

      // ── Stale meta cleanup: if postcondition says hollow, clear the false completion signals ──
      // This prevents the healer from re-evaluating the same step every cycle
      const verdict = errMeta.verdict ?? "UNKNOWN";
      const cleanedMeta = { ...meta };
      delete (cleanedMeta as any).batch_complete;
      delete (cleanedMeta as any).ok;

      await sb.from("package_steps").update({
        meta: {
          ...cleanedMeta,
          stale_completion_cleared: true,
          stale_completion_verdict: verdict,
          stale_completion_cleared_at: new Date().toISOString(),
        },
      }).eq("package_id", ps.package_id).eq("step_key", ps.step_key);

      await sb.from("auto_heal_log").insert({
        action_type: "batch_complete_stuck_heal",
        trigger_source: "stuck-scan",
        target_type: "package_step",
        target_id: ps.package_id,
        result_status: "skipped",
        result_detail: `Step ${ps.step_key} has ${signal}=true but postconditions FAILED (${verdict}): ${errMsg.slice(0, 300)} — stale signals cleared`,
        metadata: { step_key: ps.step_key, age_min: ageMin, signal, postcondition_error: errMsg.slice(0, 200), ...errMeta },
      });

      results.push({ package_id: ps.package_id, step_key: ps.step_key, action: `meta-complete-heal: BLOCKED+CLEARED (${verdict})` });
    }
  }

  if (results.length > 0) {
    console.log(`[stuck-scan] 🔄 Meta-complete healer processed ${results.length} step(s)`);
  }

  return results;
}
