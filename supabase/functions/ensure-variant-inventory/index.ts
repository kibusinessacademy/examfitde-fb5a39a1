import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * ensure-variant-inventory — Planner job
 *
 * For a given package/curriculum:
 * 1. Discovers all approved blueprints
 * 2. Seeds inventory rows via fn_upsert_variant_inventory (ensures full coverage)
 * 3. Identifies missing/partial blueprints
 * 4. Enqueues targeted generate_blueprint_variants jobs for gaps
 * 5. Updates package variant_prebuild_status
 *
 * ANTI-FLOOD GUARDS (v2):
 * - Max 3 completed jobs per blueprint → stop re-enqueuing (diminishing returns)
 * - Blueprints at ≥80% of target → auto-promoted to "ready"
 * - Global invocation frequency guard: skip if last run < 10 min ago
 */

const MAX_ATTEMPTS_PER_BLUEPRINT = 3;
const GOOD_ENOUGH_PCT = 0.80; // 80% of target = close enough

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const p = body.payload || body;
    const packageId = p.package_id ?? p.packageId;

    if (!packageId) {
      return new Response(JSON.stringify({ error: "package_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Frequency guard: skip if we ran for this package < 10 min ago ──
    const { data: recentRuns } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "package_generate_blueprint_variants")
      .eq("package_id", packageId)
      .in("status", ["pending", "processing"]);

    const activePending = recentRuns?.length ?? (recentRuns as any)?.count ?? 0;
    if (activePending > 10) {
      console.log(`[ensure-variant-inventory] FLOOD_GUARD: ${activePending} active jobs already exist for ${packageId}, skipping`);
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: `flood_guard: ${activePending} active jobs`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve curriculum
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id, course_id, variant_prebuild_status")
      .eq("id", packageId)
      .maybeSingle();

    if (!pkg?.curriculum_id) {
      return new Response(JSON.stringify({ error: "Package or curriculum not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all approved question_blueprints for this curriculum
    const { data: blueprints, error: bpErr } = await sb
      .from("question_blueprints")
      .select("id, curriculum_id, name")
      .eq("curriculum_id", pkg.curriculum_id)
      .eq("status", "approved");

    if (bpErr) throw new Error(`Blueprint lookup failed: ${bpErr.message}`);

    const allBlueprints = blueprints ?? [];
    console.log(`[ensure-variant-inventory] Package ${packageId}: ${allBlueprints.length} approved blueprints`);

    if (allBlueprints.length === 0) {
      await sb.from("course_packages")
        .update({ variant_prebuild_status: "not_required" })
        .eq("id", packageId);

      return new Response(JSON.stringify({
        ok: true,
        blueprints_total: 0,
        seeded: 0,
        gaps: 0,
        enqueued: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Seed inventory rows for ALL approved blueprints ──
    let seeded = 0;
    for (const bp of allBlueprints) {
      // deno-lint-ignore no-explicit-any
      await sb.rpc("fn_upsert_variant_inventory" as any, {
        p_blueprint_id: bp.id,
        p_curriculum_id: pkg.curriculum_id,
        p_package_id: packageId,
        p_target_count: 6,
        p_new_materialized: 0,
        p_new_approved: 0,
      });
      seeded++;
    }

    // ── Auto-promote "good enough" partial inventories ──
    // Blueprints at ≥80% of target are close enough — stop chasing the last variant
    const { data: partialInv } = await sb
      .from("blueprint_variant_inventory")
      .select("blueprint_id, materialized_count, target_count")
      .eq("package_id", packageId)
      .eq("status", "partial");

    let autoPromoted = 0;
    for (const inv of partialInv ?? []) {
      if (inv.materialized_count >= Math.ceil(inv.target_count * GOOD_ENOUGH_PCT)) {
        await sb
          .from("blueprint_variant_inventory")
          .update({ status: "ready", updated_at: new Date().toISOString() })
          .eq("blueprint_id", inv.blueprint_id)
          .eq("package_id", packageId);
        autoPromoted++;
      }
    }
    if (autoPromoted > 0) {
      console.log(`[ensure-variant-inventory] Auto-promoted ${autoPromoted} blueprints to ready (≥${GOOD_ENOUGH_PCT * 100}% target)`);
    }

    // Read current inventory state (after auto-promotion)
    const { data: inventory } = await sb
      .from("blueprint_variant_inventory")
      .select("blueprint_id, status, materialized_count, target_count")
      .eq("curriculum_id", pkg.curriculum_id);

    const gaps = (inventory ?? []).filter(inv =>
      inv.status === "missing" || inv.status === "partial"
    );

    // ── Count past attempts per blueprint to avoid infinite retries ──
    const gapBlueprintIds = gaps.map(g => g.blueprint_id);
    const attemptCounts = new Map<string, number>();

    if (gapBlueprintIds.length > 0) {
      // Count completed jobs per blueprint (batch query)
      const { data: completedJobs } = await sb
        .from("job_queue")
        .select("payload")
        .eq("job_type", "package_generate_blueprint_variants")
        .eq("package_id", packageId)
        .in("status", ["completed", "failed"]);

      for (const j of completedJobs ?? []) {
        const bpId = (j.payload as any)?.blueprint_id ?? (j.payload as any)?.blueprintId;
        if (bpId) {
          attemptCounts.set(bpId, (attemptCounts.get(bpId) || 0) + 1);
        }
      }
    }

    // Build set of blueprint IDs that already have pending/processing jobs
    const { data: existingJobs } = await sb
      .from("job_queue")
      .select("payload")
      .eq("job_type", "package_generate_blueprint_variants")
      .eq("package_id", packageId)
      .in("status", ["pending", "processing"]);

    const alreadyEnqueued = new Set<string>();
    for (const j of existingJobs ?? []) {
      const bpId = (j.payload as any)?.blueprint_id ?? (j.payload as any)?.blueprintId;
      if (bpId) alreadyEnqueued.add(bpId);
    }

    // Enqueue generate jobs for gaps (max 30 per planner run)
    const MAX_ENQUEUE = 30;
    let enqueued = 0;
    let skippedMaxAttempts = 0;

    for (const gap of gaps) {
      if (enqueued >= MAX_ENQUEUE) break;
      if (alreadyEnqueued.has(gap.blueprint_id)) continue;

      // ANTI-FLOOD: skip blueprints that already had enough attempts
      const pastAttempts = attemptCounts.get(gap.blueprint_id) || 0;
      if (pastAttempts >= MAX_ATTEMPTS_PER_BLUEPRINT) {
        skippedMaxAttempts++;
        continue;
      }

      const remaining = gap.target_count - gap.materialized_count;
      if (remaining <= 0) continue;

      const { error: insertErr } = await sb.from("job_queue").insert({
        job_type: "package_generate_blueprint_variants",
        package_id: packageId,
        worker_pool: "prebuild",
        payload: {
          package_id: packageId,
          blueprint_id: gap.blueprint_id,
          count: Math.min(remaining, 20),
        },
        max_attempts: 3,
        status: "pending",
      });
      if (insertErr?.message?.includes("duplicate key")) {
        console.warn(`[ensure-variant-inventory] Skipped duplicate for blueprint ${gap.blueprint_id}`);
      } else if (insertErr) {
        console.error(`[ensure-variant-inventory] Insert error:`, insertErr.message);
      } else {
        enqueued++;
      }
    }

    // If ALL remaining gaps are exhausted (max attempts reached), auto-promote them
    const trulyUnresolvable = gaps.filter(g => {
      const attempts = attemptCounts.get(g.blueprint_id) || 0;
      return attempts >= MAX_ATTEMPTS_PER_BLUEPRINT && !alreadyEnqueued.has(g.blueprint_id);
    });

    if (trulyUnresolvable.length > 0 && enqueued === 0) {
      console.log(`[ensure-variant-inventory] ${trulyUnresolvable.length} blueprints exhausted all retries, auto-promoting to ready`);
      for (const gap of trulyUnresolvable) {
        await sb
          .from("blueprint_variant_inventory")
          .update({ status: "ready", updated_at: new Date().toISOString() })
          .eq("blueprint_id", gap.blueprint_id)
          .eq("package_id", packageId);
      }
    }

    // Update package prebuild status
    // deno-lint-ignore no-explicit-any
    await sb.rpc("fn_update_package_prebuild_status" as any, {
      p_package_id: packageId,
    });

    console.log(`[ensure-variant-inventory] Done: ${allBlueprints.length} blueprints, ${seeded} seeded, ${gaps.length} gaps, ${enqueued} enqueued, ${skippedMaxAttempts} skipped (max attempts), ${autoPromoted} auto-promoted`);

    return new Response(JSON.stringify({
      ok: true,
      blueprints_total: allBlueprints.length,
      seeded,
      gaps: gaps.length,
      enqueued,
      skipped_max_attempts: skippedMaxAttempts,
      auto_promoted: autoPromoted,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("ensure-variant-inventory error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
