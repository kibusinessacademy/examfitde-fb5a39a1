/**
 * package-seo-pillar-ensure — Worker
 * ──────────────────────────────────
 * Wird vom job-runner für job_type = 'package_seo_pillar_ensure' aufgerufen.
 * Ruft die idempotente SSOT-Funktion fn_seo_pillar_ensure_skeleton(package_id).
 * Erzeugt PF + PV Pillar-Skeleton-Rows in blog_articles (status=reserved)
 * mit source_package_id bridge — KEIN AI-Content (Phase A: governance-first).
 *
 * Audit: fn_emit_audit → action_type='seo_pillar_ensure_run'
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const p = body.payload || body;
    const packageId: string | undefined = p.package_id ?? p.packageId;
    const jobId: string | undefined = body.job_id ?? p.job_id;

    if (!packageId) {
      return new Response(JSON.stringify({ ok: false, error: "package_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await sb.rpc("fn_seo_pillar_ensure_skeleton", {
      _package_id: packageId,
    });

    if (error) {
      // Best-effort audit
      await sb.from("auto_heal_log").insert({
        action_type: "seo_pillar_ensure_run",
        target_type: "package",
        target_id: packageId,
        result_status: "error",
        metadata: { job_id: jobId, error: error.message },
      });
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await sb.from("auto_heal_log").insert({
      action_type: "seo_pillar_ensure_run",
      target_type: "package",
      target_id: packageId,
      result_status: "success",
      metadata: { job_id: jobId, skeleton_result: data },
    });

    return new Response(
      JSON.stringify({ ok: true, package_id: packageId, result: data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
