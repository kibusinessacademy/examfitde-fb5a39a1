import { createClient } from "npm:@supabase/supabase-js@2";
import { batchHealAndDispatch } from "../_shared/heal-dispatch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;
type JsonRow = Record<string, unknown>;

async function assertAdmin(sb: SB, userId: string) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN");
}

async function auditLog(
  sb: SB,
  userId: string,
  action: string,
  payload: JsonRow,
  result: JsonRow,
  beforeState: unknown = null,
  affectedIds: string[] = [],
) {
  try {
    await sb.from("admin_actions").insert({
      user_id: userId,
      action,
      payload: payload as any,
      before_state: beforeState as any,
      after_state: result as any,
      affected_ids: affectedIds,
      scope: (result as any)?.scope || "manual",
    });
  } catch (_e) { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "Missing env configuration" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    try { await assertAdmin(sb, user.id); } catch { return json({ error: "Forbidden – admin role required" }, 403); }

    const body = (await req.json().catch(() => ({}))) as JsonRow;
    const action = String(body.action || "");

    let result: JsonRow;
    let beforeState: unknown = null;
    let affectedIds: string[] = [];

    switch (action) {
      case "requeue_failed_jobs": {
        const before = await captureBeforeState(sb, "requeue", body);
        beforeState = before.state;
        result = await requeueFailedJobs(sb, body);
        affectedIds = before.ids;
        break;
      }
      case "release_provider_cooldowns": {
        const before = await captureBeforeState(sb, "cooldowns", body);
        beforeState = before.state;
        result = await releaseProviderCooldowns(sb, body);
        affectedIds = before.ids;
        break;
      }
      case "reset_stalled_steps": {
        const before = await captureBeforeState(sb, "stuck", body);
        beforeState = before.state;
        result = await resetStalledSteps(sb, body);
        affectedIds = before.ids;
        break;
      }
      case "cancel_zombie_packages": {
        const before = await captureBeforeState(sb, "zombies", body);
        beforeState = before.state;
        result = await cancelZombiePackages(sb, body);
        affectedIds = before.ids;
        break;
      }
      case "recover_failed_packages": {
        const before = await captureBeforeState(sb, "failed_packages", body);
        beforeState = before.state;
        result = await recoverFailedPackages(sb, body);
        affectedIds = before.ids;
        break;
      }
      case "root_cause_summary":
        result = await rootCauseSummary(sb, body);
        break;

      /* ── Workspace SSOT Actions ── */
      case "retry_package_step": {
        const pid = String(body.package_id || "");
        const sk = String(body.step_key || "");
        if (!pid || !sk) return json({ error: "package_id and step_key required" }, 400);
        beforeState = { package_id: pid, step_key: sk };
        affectedIds = [`${pid}:${sk}`];
        result = await retryPackageStep(sb, pid, sk, body);
        break;
      }
      case "cancel_package_build": {
        const pid = String(body.package_id || "");
        if (!pid) return json({ error: "package_id required" }, 400);
        beforeState = { package_id: pid };
        affectedIds = [pid];
        result = await cancelPackageBuild(sb, pid);
        break;
      }
      case "force_unlock_package": {
        const pid = String(body.package_id || "");
        if (!pid) return json({ error: "package_id required" }, 400);
        affectedIds = [pid];
        result = await forceUnlockPackage(sb, pid);
        break;
      }
      case "unblock_package": {
        const pid = String(body.package_id || "");
        if (!pid) return json({ error: "package_id required" }, 400);
        const reason = String(body.reason || "admin_manual_unblock");
        beforeState = { package_id: pid };
        affectedIds = [pid];
        result = await unblockPackage(sb, pid, reason);
        break;
      }
      case "approve_step_exception": {
        const pid = String(body.package_id || "");
        const sk = String(body.step_key || "");
        const reason = String(body.reason || "");
        if (!pid || !sk || !reason) return json({ error: "package_id, step_key, and reason required" }, 400);
        affectedIds = [`${pid}:${sk}`];
        result = await approveStepException(sb, pid, sk, reason, user.id);
        break;
      }
      case "workspace_snapshot": {
        const pid = String(body.package_id || "");
        if (!pid) return json({ error: "package_id required" }, 400);
        result = await workspaceSnapshot(sb, pid);
        break;
      }

      /* ── Batch Recovery Actions (Heal + Dispatch) ── */
      case "heal_finalization_stall": {
        const limit = Number(body.limit) || 20;
        // Step 1: Run the DB-level heal (resets step statuses)
        const { data: healData, error: healErr } = await sb.rpc("heal_finalization_stall", { p_limit: limit });
        if (healErr) throw healErr;

        // Step 2: Dispatch jobs for all healed packages (atomic heal+dispatch)
        const healedPkgIds = ((healData as any)?.healed || []).map((h: any) => h.package_id).filter(Boolean);
        let dispatchResult = { healed: [] as any[], total: 0, dispatched: 0, skipped: 0 };
        if (healedPkgIds.length > 0) {
          dispatchResult = await batchHealAndDispatch(sb, healedPkgIds, "heal_finalization_stall");
        }
        result = { ...healData as JsonRow, dispatch: dispatchResult };
        affectedIds = healedPkgIds;
        break;
      }
      case "heal_non_building": {
        const limit = Number(body.limit) || 20;
        // Step 1: Run the DB-level heal (normalizes package status)
        const { data: healData, error: healErr } = await sb.rpc("heal_non_building_packages", { p_limit: limit });
        if (healErr) throw healErr;

        // Step 2: Dispatch jobs for all healed packages (atomic heal+dispatch)
        const healedPkgIds = ((healData as any)?.healed || []).map((h: any) => h.package_id).filter(Boolean);
        let dispatchResult = { healed: [] as any[], total: 0, dispatched: 0, skipped: 0 };
        if (healedPkgIds.length > 0) {
          dispatchResult = await batchHealAndDispatch(sb, healedPkgIds, "heal_non_building");
        }
        result = { ...healData as JsonRow, dispatch: dispatchResult };
        affectedIds = healedPkgIds;
        break;
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }

    // Audit log with before/after (fire-and-forget) — skip read-only
    if (action !== "root_cause_summary" && action !== "workspace_snapshot") {
      auditLog(sb, user.id, action, body, result, beforeState, affectedIds);
    }

    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/* ── Before-state capture ── */
async function captureBeforeState(sb: SB, type: string, body: JsonRow) {
  try {
    switch (type) {
      case "requeue": {
        let q = sb.from("job_queue").select("id, status, last_error, attempts").eq("status", "failed");
        if (typeof body.package_id === "string") q = q.eq("package_id", body.package_id);
        if (Array.isArray(body.job_ids)) q = q.in("id", body.job_ids.map(String));
        const { data } = await q.limit(100);
        return { state: { failed_jobs: data?.length ?? 0, sample: data?.slice(0, 5) }, ids: (data || []).map((r: any) => r.id) };
      }
      case "cooldowns": {
        let q = sb.from("llm_provider_cooldowns").select("id, provider, cooldown_until");
        if (typeof body.provider === "string") q = q.eq("provider", body.provider);
        const { data } = await q.limit(50);
        return { state: { active_cooldowns: data?.length ?? 0 }, ids: (data || []).map((r: any) => r.id) };
      }
      case "stuck": {
        if (typeof body.package_id === "string" && typeof body.step_key === "string") {
          return { state: { single_step: true, package_id: body.package_id, step_key: body.step_key }, ids: [`${body.package_id}:${body.step_key}`] };
        }
        const { data } = await sb.from("ops_package_steps_stuck").select("package_id, step_key").limit(20);
        return { state: { stuck_count: data?.length ?? 0 }, ids: (data || []).map((r: any) => `${r.package_id}:${r.step_key}`) };
      }
      case "zombies": {
        if (typeof body.package_id === "string") {
          return { state: { single_package: body.package_id }, ids: [body.package_id as string] };
        }
        const { data } = await sb.from("ops_building_without_job_or_lease").select("package_id").limit(20);
        return { state: { zombie_count: data?.length ?? 0 }, ids: (data || []).map((r: any) => r.package_id) };
      }
      case "failed_packages": {
        let q = sb.from("course_packages").select("id, title, status, last_error").eq("status", "failed");
        if (typeof body.package_id === "string") q = q.eq("id", body.package_id);
        const { data } = await q.limit(20);
        return { state: { failed_count: data?.length ?? 0, sample: data?.slice(0, 5) }, ids: (data || []).map((r: any) => r.id) };
      }
      default:
        return { state: null, ids: [] };
    }
  } catch {
    return { state: null, ids: [] };
  }
}

/* ── Scoped: requeue_failed_jobs ── */
async function requeueFailedJobs(sb: SB, body: JsonRow) {
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(100, body.limit)) : 20;

  if (Array.isArray(body.job_ids) && body.job_ids.length > 0) {
    const ids = body.job_ids.map(String).slice(0, 100);
    const { error } = await sb.from("job_queue")
      .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
      .in("id", ids).eq("status", "failed");
    if (error) throw error;
    return { ok: true, updated: ids.length, scope: "job_ids" };
  }

  let query = sb.from("job_queue").select("id").eq("status", "failed");
  if (typeof body.package_id === "string") query = query.eq("package_id", body.package_id);
  if (typeof body.job_type === "string") query = query.eq("job_type", body.job_type);

  const { data: jobs, error: fetchErr } = await query.order("updated_at", { ascending: false }).limit(limit);
  if (fetchErr) throw fetchErr;
  if (!jobs?.length) return { ok: true, updated: 0 };

  const ids = jobs.map((j: any) => j.id);
  const { error: updErr } = await sb.from("job_queue")
    .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (updErr) throw updErr;
  return { ok: true, updated: ids.length, scope: body.package_id ? "package" : body.job_type ? "job_type" : "global" };
}

/* ── Scoped: release_provider_cooldowns ── */
async function releaseProviderCooldowns(sb: SB, body: JsonRow) {
  const provider = typeof body.provider === "string" ? body.provider : null;
  let query = sb.from("llm_provider_cooldowns")
    .update({ cooldown_until: new Date(0).toISOString(), updated_at: new Date().toISOString() });
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return { ok: true, updated: data?.length ?? 0, scope: provider ? "provider" : "global" };
}

/* ── Scoped: reset_stalled_steps ── */
async function resetStalledSteps(sb: SB, body: JsonRow) {
  if (typeof body.package_id === "string" && typeof body.step_key === "string") {
    const { error } = await sb.from("package_steps")
      .update({ status: "queued", started_at: null, finished_at: null, last_error: null, updated_at: new Date().toISOString() })
      .eq("package_id", body.package_id).eq("step_key", body.step_key);
    if (error) throw error;
    return { ok: true, updated: 1, scope: "single_step" };
  }

  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(100, body.limit)) : 20;
  const { data: rows, error: fetchErr } = await sb.from("ops_package_steps_stuck").select("package_id,step_key").limit(limit);
  if (fetchErr) throw fetchErr;
  if (!rows?.length) return { ok: true, updated: 0 };

  let updated = 0;
  for (const row of rows as any[]) {
    if (!row.package_id || !row.step_key) continue;
    const { error } = await sb.from("package_steps")
      .update({ status: "queued", started_at: null, finished_at: null, last_error: null, updated_at: new Date().toISOString() })
      .eq("package_id", row.package_id).eq("step_key", row.step_key);
    if (!error) updated += 1;
  }
  return { ok: true, updated, scope: "global" };
}

/* ── Scoped: cancel_zombie_packages ── */
async function cancelZombiePackages(sb: SB, body: JsonRow) {
  if (typeof body.package_id === "string") {
    const { error } = await sb.from("course_packages")
      .update({ status: "blocked", blocked_reason: "admin_phase3_cancelled_zombie", updated_at: new Date().toISOString() })
      .eq("id", body.package_id);
    if (error) throw error;
    return { ok: true, updated: 1, scope: "single_package" };
  }

  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(100, body.limit)) : 20;
  const { data: zombies, error: fetchErr } = await sb.from("ops_building_without_job_or_lease").select("package_id").limit(limit);
  if (fetchErr) throw fetchErr;
  if (!zombies?.length) return { ok: true, updated: 0 };

  const ids = (zombies as any[]).map(z => z.package_id).filter(Boolean);
  if (!ids.length) return { ok: true, updated: 0 };

  const { error } = await sb.from("course_packages")
    .update({ status: "blocked", blocked_reason: "admin_phase3_cancelled_zombie", updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
  return { ok: true, updated: ids.length, scope: "global" };
}

/* ── Root Cause Summary (read-only) ── */
async function rootCauseSummary(sb: SB, body: JsonRow) {
  const hours = typeof body.hours === "number" ? Math.min(48, Math.max(1, body.hours)) : 24;
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  const { data: rows, error } = await sb.from("job_queue")
    .select("job_type, last_error, status, payload")
    .eq("status", "failed").gte("updated_at", since)
    .order("updated_at", { ascending: false }).limit(500);
  if (error) throw error;
  if (!rows?.length) return { ok: true, groups: [], total: 0 };

  const buckets = new Map<string, { job_type: string; pattern: string; count: number; sample: string }>();
  for (const r of rows as any[]) {
    const rawErr = String(r.last_error || "unknown");
    const pattern = rawErr
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<ts>")
      .slice(0, 120);
    const key = `${r.job_type}||${pattern}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { job_type: r.job_type, pattern, count: 1, sample: rawErr.slice(0, 200) });
  }

  return { ok: true, groups: [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, 15), total: rows.length, hours };
}

/* ── Scoped: recover_failed_packages ── */
async function recoverFailedPackages(sb: SB, body: JsonRow) {
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(20, body.limit)) : 10;

  // Build query for failed packages
  let query = sb.from("course_packages").select("id, title, retry_count").eq("status", "failed");
  if (typeof body.package_id === "string") query = query.eq("id", body.package_id);

  const { data: pkgs, error: fetchErr } = await query.order("updated_at", { ascending: true }).limit(limit);
  if (fetchErr) throw fetchErr;
  if (!pkgs?.length) return { ok: true, recovered: 0, details: [] };

  const details: { id: string; title: string; steps_reset: number }[] = [];

  for (const pkg of pkgs as any[]) {
    // Reset failed/timeout steps to queued
    const { data: failedSteps } = await sb
      .from("package_steps")
      .select("step_key")
      .eq("package_id", pkg.id)
      .in("status", ["failed", "timeout"]);

    let stepsReset = 0;
    for (const step of (failedSteps || []) as any[]) {
      const { error } = await sb.from("package_steps").update({
        status: "queued",
        attempts: 0,
        job_id: null,
        runner_id: null,
        started_at: null,
        last_error: "Admin manual recovery via recover_failed_packages",
        updated_at: new Date().toISOString(),
      }).eq("package_id", pkg.id).eq("step_key", step.step_key);
      if (!error) stepsReset++;
    }

    // Cancel stale failed jobs
    await sb.from("job_queue")
      .update({ status: "cancelled", last_error: "Admin recover_failed_packages cleanup" })
      .eq("package_id", pkg.id)
      .eq("status", "failed");

    // Reset package to building
    await sb.from("course_packages").update({
      status: "building",
      retry_count: (pkg.retry_count ?? 0) + 1,
      last_error: `Admin recovery: ${stepsReset} steps reset`,
      updated_at: new Date().toISOString(),
    }).eq("id", pkg.id);

    details.push({ id: pkg.id, title: pkg.title || pkg.id.slice(0, 8), steps_reset: stepsReset });
  }

  return { ok: true, recovered: details.length, details, scope: body.package_id ? "single" : "global" };
}

/* ── retry_package_step ── */
async function retryPackageStep(sb: SB, packageId: string, stepKey: string, body: JsonRow) {
  // Reset the step
  const { error: stepErr } = await sb.from("package_steps")
    .update({ status: "queued", last_error: null, meta: null, started_at: null, finished_at: null, attempts: 0, updated_at: new Date().toISOString() })
    .eq("package_id", packageId).eq("step_key", stepKey);
  if (stepErr) throw stepErr;

  // Fetch package context for job payload
  const { data: pkg } = await sb.from("course_packages")
    .select("course_id, curriculum_id, certification_id")
    .eq("id", packageId).single();

  // Enqueue a new job
  const { error: jobErr } = await sb.from("job_queue").insert({
    job_type: `package_${stepKey}`,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    run_after: new Date().toISOString(),
    payload: {
      job_version: "course_studio_v2",
      package_id: packageId,
      step_key: stepKey,
      course_id: (pkg as any)?.course_id || null,
      curriculum_id: (pkg as any)?.curriculum_id || null,
      certification_id: (pkg as any)?.certification_id || null,
    },
  });
  if (jobErr) throw jobErr;

  return { ok: true, step_key: stepKey, scope: "single_step" };
}

/* ── cancel_package_build ── */
async function cancelPackageBuild(sb: SB, packageId: string) {
  // Cancel pending/processing jobs
  const { data: jobs } = await sb.from("job_queue")
    .select("id")
    .or(`payload->>package_id.eq.${packageId}`)
    .in("status", ["pending", "processing"]);
  
  if (jobs?.length) {
    const ids = (jobs as any[]).map((j: any) => j.id);
    await sb.from("job_queue")
      .update({ status: "failed", last_error: "Cancelled by admin", updated_at: new Date().toISOString() })
      .in("id", ids);
  }

  // Reset package status
  const { error: pkgErr } = await sb.from("course_packages")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("id", packageId);
  if (pkgErr) throw pkgErr;

  // Remove locks
  await sb.from("course_package_locks").delete().eq("package_id", packageId);

  return { ok: true, jobs_cancelled: jobs?.length ?? 0, scope: "single_package" };
}

/* ── force_unlock_package ── */
async function forceUnlockPackage(sb: SB, packageId: string) {
  const { data, error } = await sb.from("course_package_locks")
    .delete()
    .eq("package_id", packageId)
    .select("package_id");
  if (error) throw error;
  return { ok: true, locks_removed: data?.length ?? 0, scope: "single_package" };
}

/* ── unblock_package — sets blocked → building, clears loop guards on steps ── */
async function unblockPackage(sb: SB, packageId: string, reason: string) {
  // 1. Set package status from blocked → building
  const { error: pkgErr } = await sb.from("course_packages")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", packageId)
    .eq("status", "blocked");
  if (pkgErr) throw pkgErr;

  // 2. Remove locks
  await sb.from("course_package_locks").delete().eq("package_id", packageId);

  // 3. Reset any blocked steps back to queued, clear loop guard meta
  const { data: blockedSteps } = await sb.from("package_steps")
    .select("step_key, meta")
    .eq("package_id", packageId)
    .eq("status", "blocked");

  const resetStepKeys: string[] = [];
  for (const step of (blockedSteps || [])) {
    const meta = (step as any).meta || {};
    const cleanedMeta = {
      ...meta,
      loop_guard_blocked: false,
      unblocked_at: new Date().toISOString(),
      unblock_reason: reason,
    };
    await sb.from("package_steps")
      .update({ status: "queued", meta: cleanedMeta, updated_at: new Date().toISOString() })
      .eq("package_id", packageId)
      .eq("step_key", (step as any).step_key);
    resetStepKeys.push((step as any).step_key);
  }

  return { ok: true, reset_steps: resetStepKeys, reason, scope: "single_package" };
}

/* ── approve_step_exception ── */
async function approveStepException(sb: SB, packageId: string, stepKey: string, reason: string, userId: string) {
  const { error } = await sb.from("package_steps")
    .update({
      status: "done",
      exception_approved: true,
      exception_reason: reason,
      exception_approved_by: userId,
      exception_approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("package_id", packageId)
    .eq("step_key", stepKey);
  if (error) throw error;
  return { ok: true, step_key: stepKey, scope: "single_step" };
}

/* ── workspace_snapshot (read-only) ── */
async function workspaceSnapshot(sb: SB, packageId: string) {
  // Package info
  const { data: pkg, error: pkgErr } = await sb.from("course_packages")
    .select("id, title, status, build_progress, integrity_passed, council_approved, council_approved_at, track, feature_flags, certification_id, course_id, curriculum_id, created_at, updated_at")
    .eq("id", packageId).single();
  if (pkgErr) throw pkgErr;

  // Steps
  const { data: steps } = await sb.from("package_steps")
    .select("step_key, status, attempts, max_attempts, last_error, started_at, finished_at, meta")
    .eq("package_id", packageId)
    .order("sort_order", { ascending: true });

  // Active locks
  const { data: locks } = await sb.from("course_package_locks")
    .select("lock_type, locked_at, locked_by")
    .eq("package_id", packageId);

  // Active jobs
  const { data: jobs } = await sb.from("job_queue")
    .select("id, job_type, status, attempts, last_error, created_at")
    .or(`payload->>package_id.eq.${packageId}`)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(20);

  // Councils
  const { data: councils } = await sb.from("council_sessions")
    .select("council_type, status, decision, decided_at")
    .eq("package_id", packageId);

  // Compute derived KPIs
  const allSteps = (steps || []) as any[];
  const doneCount = allSteps.filter((s: any) => s.status === "done" || s.status === "skipped").length;
  const failedCount = allSteps.filter((s: any) => s.status === "failed").length;
  const totalCount = allSteps.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return {
    ok: true,
    package: pkg,
    steps: steps || [],
    locks: locks || [],
    active_jobs: jobs || [],
    councils: councils || [],
    kpi: {
      progress_pct: progressPct,
      done: doneCount,
      failed: failedCount,
      total: totalCount,
      has_locks: (locks?.length ?? 0) > 0,
      active_jobs_count: jobs?.length ?? 0,
    },
  };
}
