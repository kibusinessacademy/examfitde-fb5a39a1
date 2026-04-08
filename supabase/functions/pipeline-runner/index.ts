import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getTrackQuota, TRACK_ACQUISITION_ORDER, WIP_TOTAL_CAP, rebalanceQuotas, type TrackKey as WipTrackKey, type TrackStats } from "../_shared/worker-config.ts";
import { getStepClassLimits, getMaxActivePackages, type StepWeightClass } from "../_shared/step-weight.ts";
import { json, safeRpc, safeQuery, type StepClassContext } from "../_shared/pipeline-helpers.ts";
import { processPackage } from "../_shared/pipeline-process.ts";

/**
 * pipeline-runner — Pure Orchestrator (v5: Step-Weighted, Track-Fair)
 *
 * The Runner NEVER executes steps directly. It only:
 * 1. Acquires package leases in a loop (up to max_concurrent_packages)
 * 2. Determines next step via state machine for each acquired package
 * 3. Enqueues worker jobs into job_queue
 * 4. Polls enqueued job status and propagates results
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RUNNER_VERSION = "v5.1-modular";
const RUNNER_INSTANCE_ID = `runner_${crypto.randomUUID().slice(0, 8)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── Health endpoint ──
  const url = new URL(req.url);
  const isHealthCheck = url.searchParams.get("health") === "1";
  let bodyHealth = false;
  if (!isHealthCheck && req.method === "POST") {
    try {
      const cloned = req.clone();
      const b = await cloned.json();
      bodyHealth = b?.health === true || b?.dryRun === true;
    } catch { /* not JSON */ }
  }

  if (isHealthCheck || bodyHealth) {
    await safeRpc(sb, "upsert_worker_heartbeat", {
      p_worker_name: "pipeline-runner",
      p_instance_id: RUNNER_INSTANCE_ID,
      p_version: RUNNER_VERSION,
      p_processed_count: 0,
      p_metadata: { type: "health_check" },
    });
    return json({
      ok: true,
      health: true,
      version: RUNNER_VERSION,
      instance: RUNNER_INSTANCE_ID,
      timestamp: new Date().toISOString(),
    });
  }

  // Read max slots from config
  const { data: configRow } = await sb
    .from("ops_pipeline_config")
    .select("value")
    .eq("key", "max_concurrent_packages")
    .maybeSingle();
  const maxSlots = Math.min(
    parseInt(configRow?.value ?? "6", 10),
    getMaxActivePackages(),
  );

  // ── Step-class capacity snapshot ──
  const stepClassLimits = getStepClassLimits();
  const { data: loadRows } = await sb
    .from("v_package_step_load")
    .select("package_id, step_class");

  const classLoad: Record<StepWeightClass, Set<string>> = {
    heavy: new Set(), medium: new Set(), validation: new Set(), light: new Set(),
  };
  for (const r of (loadRows ?? []) as { package_id: string; step_class: string }[]) {
    const cls = r.step_class as StepWeightClass;
    if (classLoad[cls]) classLoad[cls].add(r.package_id);
  }

  console.log(`[runner] 📊 Step-class load: heavy=${classLoad.heavy.size}/${stepClassLimits.heavy} medium=${classLoad.medium.size}/${stepClassLimits.medium} validation=${classLoad.validation.size}/${stepClassLimits.validation} light=${classLoad.light.size}/${stepClassLimits.light}`);

  const stepClassCtx: StepClassContext = { limits: stepClassLimits, load: classLoad };

  const results: Record<string, unknown>[] = [];
  const processedPackageIds = new Set<string>();

  try {
    // ── Track-Fair WIP Quota Calculation (consolidated queries) ──
    const [{ data: wipRows }, { data: targetRows }] = await Promise.all([
      sb.from("course_packages").select("track").eq("status", "building"),
      sb.from("course_packages").select("track").eq("status", "queued").lte("priority", 10),
    ]);

    const wipByTrack: Record<string, number> = {};
    for (const r of (wipRows ?? []) as { track: string }[]) {
      const t = String(r.track || "AUSBILDUNG_VOLL");
      wipByTrack[t] = (wipByTrack[t] ?? 0) + 1;
    }

    const targetsByTrack: Record<string, number> = {};
    for (const r of (targetRows ?? []) as { track: string }[]) {
      const t = String(r.track || "AUSBILDUNG_VOLL");
      targetsByTrack[t] = (targetsByTrack[t] ?? 0) + 1;
    }

    const trackStats: Record<WipTrackKey, TrackStats> = {} as any;
    for (const track of TRACK_ACQUISITION_ORDER) {
      trackStats[track] = {
        active: wipByTrack[track] ?? 0,
        quota: getTrackQuota(track),
        targets: targetsByTrack[track] ?? 0,
      };
    }
    const effectiveQuotas = rebalanceQuotas(trackStats);

    const trackSlots: Record<string, number> = {};
    for (const track of TRACK_ACQUISITION_ORDER) {
      const current = wipByTrack[track] ?? 0;
      trackSlots[track] = Math.max(0, effectiveQuotas[track] - current);
    }

    const starvedTracks = TRACK_ACQUISITION_ORDER.filter(t =>
      trackStats[t].targets > 0 && trackSlots[t] === 0
    );

    console.log(`[runner] 📊 WIP quotas: ${TRACK_ACQUISITION_ORDER.map(t =>
      `${t}=${wipByTrack[t] ?? 0}/${effectiveQuotas[t]}(base=${getTrackQuota(t)},slots=${trackSlots[t]},targets=${targetsByTrack[t] ?? 0})`
    ).join(", ")}${starvedTracks.length ? ` | ⚠️ STARVED: ${starvedTracks.join(",")}` : ""}`);

    let totalAcquired = 0;

    // ── Phase 1: Acquire ALL packages first, then process in parallel ──
    const acquired: Array<{ packageId: string; runnerId: string; track: string }> = [];

    for (const track of TRACK_ACQUISITION_ORDER) {
      const slotsForTrack = trackSlots[track];
      if (slotsForTrack <= 0 || totalAcquired >= maxSlots) continue;

      const claimCount = Math.min(slotsForTrack, maxSlots - totalAcquired);

      for (let i = 0; i < claimCount; i++) {
        const runnerId = `runner_${crypto.randomUUID().slice(0, 8)}`;

        const { data: pkgId, error: acquireErr } = await sb.rpc(
          "acquire_next_package_lease_v2",
          { p_runner_id: runnerId, p_lease_seconds: 120, p_track: track },
        );

        if (acquireErr) {
          const msg = acquireErr.message || "unknown acquire error";
          console.error(`[runner] acquire error for ${track} slot ${i}:`, msg);
          if (msg.includes("PACKAGE_LEASES_NON_BUILDING")) {
            await safeRpc(sb, "ops_hygiene_cleanup", {
              p_max_lease_cleanup: 100,
              p_max_job_cleanup: 200,
            });
            continue;
          }
          break;
        }

        if (!pkgId) break;

        const packageId = String(pkgId);
        if (processedPackageIds.has(packageId)) {
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          continue;
        }
        processedPackageIds.add(packageId);
        totalAcquired++;
        acquired.push({ packageId, runnerId, track });
        console.log(`[runner] Acquired ${track} slot ${acquired.length}/${claimCount}: package ${packageId.slice(0, 8)}`);
      }
    }

    // ── Phase 2: Borrow remaining global slots ──
    if (totalAcquired < maxSlots) {
      const remaining = maxSlots - totalAcquired;
      for (let i = 0; i < remaining; i++) {
        const runnerId = `runner_${crypto.randomUUID().slice(0, 8)}`;
        const { data: pkgId, error: acquireErr } = await sb.rpc(
          "acquire_next_package_lease_v2",
          { p_runner_id: runnerId, p_lease_seconds: 120, p_track: null },
        );

        if (acquireErr) break;
        if (!pkgId) break;

        const packageId = String(pkgId);
        if (processedPackageIds.has(packageId)) {
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          continue;
        }
        processedPackageIds.add(packageId);
        totalAcquired++;
        acquired.push({ packageId, runnerId, track: "borrow" });
        console.log(`[runner] Borrow slot: package ${packageId.slice(0, 8)}`);
      }
    }

    // ── Phase 3: Process ALL acquired packages in parallel (max 4 concurrent) ──
    const PARALLEL_BATCH_SIZE = 4;
    for (let batchStart = 0; batchStart < acquired.length; batchStart += PARALLEL_BATCH_SIZE) {
      const batch = acquired.slice(batchStart, batchStart + PARALLEL_BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async ({ packageId, runnerId, track }, idx) => {
          const result = await processPackage(sb, packageId, runnerId, stepClassCtx);
          return { slot: batchStart + idx + 1, track, ...result };
        }),
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          results.push({ error: r.reason?.message ?? "parallel_process_error" });
        }
      }
    }

    // Log starvation warning
    for (const track of TRACK_ACQUISITION_ORDER) {
      if (trackSlots[track] > 0) {
        const claimed = results.filter(r => (r as any).track === track).length;
        if (claimed === 0) {
          console.warn(`[runner] ⚠️ STARVATION: ${track} had ${trackSlots[track]} free slots but claimed 0 packages`);
        }
      }
    }

    // ── Write heartbeat ──
    const lastErr = results.find(r => (r as Record<string, unknown>).error)
      ? String((results.find(r => (r as Record<string, unknown>).error) as Record<string, unknown>).error)
      : null;
    await safeRpc(sb, "upsert_worker_heartbeat", {
      p_worker_name: "pipeline-runner",
      p_instance_id: RUNNER_INSTANCE_ID,
      p_version: RUNNER_VERSION,
      p_processed_count: results.length,
      p_last_error: lastErr,
      p_metadata: { slots_used: results.length, max_slots: maxSlots },
    });

    if (results.length === 0) {
      return json({ ok: true, idle: true, reason: "no_claimable_packages_or_slots_full" });
    }

    console.log(`[runner] Processed ${results.length} package(s) in this invocation`);
    return json({ ok: true, processed: results.length, version: RUNNER_VERSION, results });

  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[runner] Fatal:", msg);
    await safeRpc(sb, "upsert_worker_heartbeat", {
      p_worker_name: "pipeline-runner",
      p_instance_id: RUNNER_INSTANCE_ID,
      p_version: RUNNER_VERSION,
      p_processed_count: 0,
      p_last_error: msg,
      p_metadata: { fatal: true },
    });
    return json({ ok: false, error: msg, version: RUNNER_VERSION }, 500);
  }
});
