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
 * 2. Upserts inventory rows (blueprint_variant_inventory)
 * 3. Identifies missing/partial blueprints
 * 4. Enqueues targeted generate_blueprint_variants jobs for gaps
 * 5. Updates package variant_prebuild_status
 *
 * Designed to run in the 'prebuild' worker pool.
 */
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
      // No blueprints → nothing to prebuild
      await sb.from("course_packages")
        .update({ variant_prebuild_status: "pending" })
        .eq("id", packageId);

      return new Response(JSON.stringify({
        ok: true,
        blueprints_total: 0,
        gaps: 0,
        enqueued: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert inventory rows for all blueprints
    const inventoryRows = allBlueprints.map(bp => ({
      blueprint_id: bp.id,
      curriculum_id: pkg.curriculum_id,
      package_id: packageId,
      target_count: 20,
    }));

    // Batch upsert
    for (const row of inventoryRows) {
      await sb.from("blueprint_variant_inventory")
        .upsert(row, { onConflict: "blueprint_id,curriculum_id" });
    }

    // Read current inventory state
    const { data: inventory } = await sb
      .from("blueprint_variant_inventory")
      .select("blueprint_id, status, materialized_count, target_count")
      .eq("curriculum_id", pkg.curriculum_id);

    const gaps = (inventory ?? []).filter(inv =>
      inv.status === "missing" || inv.status === "partial"
    );

    // Enqueue generate jobs for gaps (max 30 per planner run)
    const MAX_ENQUEUE = 30;
    const toEnqueue = gaps.slice(0, MAX_ENQUEUE);
    let enqueued = 0;

    for (const gap of toEnqueue) {
      // Check if there's already a pending/processing job for this blueprint
      const { data: existing } = await sb
        .from("job_queue")
        .select("id")
        .eq("job_type", "package_generate_blueprint_variants")
        .in("status", ["pending", "processing"])
        .eq("payload->>blueprint_id", gap.blueprint_id)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const remaining = gap.target_count - gap.materialized_count;
      if (remaining <= 0) continue;

      await sb.from("job_queue").insert({
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
      enqueued++;
    }

    // Update package prebuild status
    await sb.rpc("fn_update_package_prebuild_status" as any, {
      p_package_id: packageId,
    });

    // Set to materializing if we enqueued work
    if (enqueued > 0) {
      await sb.from("course_packages")
        .update({ variant_prebuild_status: "materializing" })
        .eq("id", packageId)
        .eq("variant_prebuild_status", "pending");
    }

    console.log(`[ensure-variant-inventory] Done: ${allBlueprints.length} blueprints, ${gaps.length} gaps, ${enqueued} enqueued`);

    return new Response(JSON.stringify({
      ok: true,
      blueprints_total: allBlueprints.length,
      gaps: gaps.length,
      enqueued,
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
