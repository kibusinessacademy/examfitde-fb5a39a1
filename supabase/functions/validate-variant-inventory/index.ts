import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * validate-variant-inventory — Validator job
 *
 * For a given package:
 * 1. Checks all inventory entries for coverage
 * 2. Reconciles actual counts from exam_question_variants table
 * 3. Updates variant_prebuild_status on package
 * 4. Returns readiness assessment
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
      .select("curriculum_id")
      .eq("id", packageId)
      .maybeSingle();

    if (!pkg?.curriculum_id) {
      return new Response(JSON.stringify({ error: "Package not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all inventory entries for this curriculum
    const { data: inventory } = await sb
      .from("blueprint_variant_inventory")
      .select("id, blueprint_id, materialized_count, approved_count, target_count, status")
      .eq("curriculum_id", pkg.curriculum_id);

    if (!inventory || inventory.length === 0) {
      await sb.from("course_packages")
        .update({ variant_prebuild_status: "pending" })
        .eq("id", packageId);

      return new Response(JSON.stringify({
        ok: true,
        ready: false,
        reason: "no_inventory",
        total: 0,
        ready_count: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reconcile: count actual variants per blueprint from exam_question_variants
    let reconciled = 0;
    for (const inv of inventory) {
      const { count: actualCount } = await sb
        .from("exam_question_variants")
        .select("id", { count: "exact", head: true })
        .eq("blueprint_id", inv.blueprint_id);

      const { count: approvedCount } = await sb
        .from("exam_question_variants")
        .select("id", { count: "exact", head: true })
        .eq("blueprint_id", inv.blueprint_id)
        .in("status", ["review", "approved", "promoted"]);

      const newMat = actualCount ?? 0;
      const newAppr = approvedCount ?? 0;

      if (newMat !== inv.materialized_count || newAppr !== inv.approved_count) {
        await sb.from("blueprint_variant_inventory")
          .update({
            materialized_count: newMat,
            approved_count: newAppr,
          })
          .eq("id", inv.id);
        reconciled++;
      }
    }

    // Update package prebuild status
    const newStatus = await sb.rpc("fn_update_package_prebuild_status" as any, {
      p_package_id: packageId,
    });

    // Check readiness
    const isReady = await sb.rpc("fn_is_variant_inventory_ready" as any, {
      p_package_id: packageId,
    });

    const readyCount = inventory.filter(i => i.status === "ready").length;

    console.log(`[validate-variant-inventory] Package ${packageId}: ${inventory.length} entries, ${readyCount} ready, ${reconciled} reconciled, status=${newStatus?.data}`);

    return new Response(JSON.stringify({
      ok: true,
      ready: isReady?.data ?? false,
      status: newStatus?.data ?? "unknown",
      total: inventory.length,
      ready_count: readyCount,
      reconciled,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("validate-variant-inventory error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
