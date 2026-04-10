import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-recalculate-discovery-state – Bulk recalculate discovery state + drift detection
 *
 * Actions:
 *   recalculate_all   – Recalculate all known source entries
 *   recalculate_one   – Recalculate a single source
 *   detect_drift      – Run drift detection across all entries
 *   dashboard_summary – Get aggregated dashboard stats
 *   compute_scores    – Run content score computation
 *   build_refresh     – Build refresh queue from audits + drift
 *   detect_gaps       – Detect content gaps
 *   detect_cannibal   – Detect keyword cannibalization
 */

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const action = body.action || "recalculate_all";

  try {
    if (action === "recalculate_one") {
      const { source_type, source_id } = body;
      if (!source_type || !source_id) {
        return new Response(JSON.stringify({ error: "source_type, source_id required" }), { status: 400, headers });
      }
      const { data, error } = await sb.rpc("fn_upsert_seo_discovery_state", {
        p_source_type: source_type, p_source_id: source_id, p_force: true,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, result: data }), { headers });
    }

    if (action === "recalculate_all") {
      let synced = 0;
      // Process blog_posts
      const { data: blogs } = await sb.from("blog_posts").select("id").eq("status", "published").limit(500);
      for (const b of blogs || []) {
        await sb.rpc("fn_upsert_seo_discovery_state", {
          p_source_type: "blog_post", p_source_id: b.id, p_force: !!body.force,
        });
        synced++;
      }
      // Process content_pages
      const { data: pages } = await sb.from("content_pages").select("id").eq("status", "published").limit(500);
      for (const p of pages || []) {
        await sb.rpc("fn_upsert_seo_discovery_state", {
          p_source_type: "content_page", p_source_id: p.id, p_force: !!body.force,
        });
        synced++;
      }
      // Process seo_documents
      const { data: docs } = await sb.from("seo_documents").select("id").eq("status", "published").limit(500);
      for (const d of docs || []) {
        await sb.rpc("fn_upsert_seo_discovery_state", {
          p_source_type: "seo_document", p_source_id: d.id, p_force: !!body.force,
        });
        synced++;
      }
      return new Response(JSON.stringify({ ok: true, synced }), { headers });
    }

    if (action === "detect_drift") {
      const { data: drifts, error } = await sb.rpc("fn_detect_seo_discovery_drift");
      if (error) throw error;

      // Write drift status back
      let updated = 0;
      for (const d of drifts || []) {
        await sb.from("seo_discovery_state").update({
          drift_status: d.drift_status,
          drift_reasons: d.drift_reasons,
          updated_at: new Date().toISOString(),
        }).eq("source_type", d.source_type).eq("source_id", d.source_id);
        updated++;
      }

      // Clear drift for entries not in drift list
      if ((drifts || []).length > 0) {
        const driftIds = (drifts || []).map((d: { source_id: string }) => d.source_id);
        await sb.from("seo_discovery_state").update({
          drift_status: "ok", drift_reasons: [],
        }).eq("drift_status", "drift").not("source_id", "in", `(${driftIds.join(",")})`);
      }

      return new Response(JSON.stringify({ ok: true, drift_count: drifts?.length || 0, updated }), { headers });
    }

    if (action === "dashboard_summary") {
      const { data, error } = await sb.rpc("fn_get_seo_discovery_dashboard_summary");
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, summary: data }), { headers });
    }

    if (action === "compute_scores") {
      let computed = 0;
      // Score blog posts
      const { data: blogs } = await sb.from("blog_posts").select("id").eq("status", "published").limit(200);
      for (const b of blogs || []) {
        await sb.rpc("fn_compute_content_scores", { p_content_id: b.id, p_content_type: "blog_post" });
        computed++;
      }
      const { data: pages } = await sb.from("content_pages").select("id").eq("status", "published").limit(200);
      for (const p of pages || []) {
        await sb.rpc("fn_compute_content_scores", { p_content_id: p.id, p_content_type: "content_page" });
        computed++;
      }
      const { data: docs } = await sb.from("seo_documents").select("id").eq("status", "published").limit(200);
      for (const d of docs || []) {
        await sb.rpc("fn_compute_content_scores", { p_content_id: d.id, p_content_type: "seo_document" });
        computed++;
      }
      return new Response(JSON.stringify({ ok: true, computed }), { headers });
    }

    if (action === "build_refresh") {
      const { data, error } = await sb.rpc("fn_build_refresh_queue");
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, queued: data }), { headers });
    }

    if (action === "detect_gaps") {
      const { data, error } = await sb.rpc("fn_detect_content_gaps", {
        p_cluster_id: body.cluster_id || null,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, gaps: data }), { headers });
    }

    if (action === "detect_cannibal") {
      const { data, error } = await sb.rpc("fn_detect_keyword_cannibalization");
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, cannibalization: data }), { headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });

  } catch (err) {
    console.error("[seo-recalculate-discovery-state] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
