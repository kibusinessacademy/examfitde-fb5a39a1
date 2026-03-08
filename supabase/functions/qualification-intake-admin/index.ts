import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json, getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const action = body.action || "status";

  // --- STATUS ---
  if (action === "status") {
    const [runs, candidates, queue, catalog] = await Promise.all([
      sb.from("qualification_search_runs").select("id", { count: "exact", head: true }),
      sb.from("qualification_candidates").select("id", { count: "exact", head: true }),
      sb.from("qualification_fetch_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("qualification_catalog").select("id", { count: "exact", head: true }),
    ]);

    return json(200, {
      ok: true,
      search_runs: runs.count ?? 0,
      candidates: candidates.count ?? 0,
      pending_fetches: queue.count ?? 0,
      catalog_entries: catalog.count ?? 0,
    }, origin);
  }

  // --- READY DRAFTS ---
  if (action === "ready_drafts") {
    const minReadiness = Number(body.min_readiness ?? 60);
    const { data, error } = await sb
      .from("qualification_curriculum_drafts")
      .select(`
        id,
        draft_title,
        readiness_score,
        status,
        structure_json,
        qualification_catalog:qualification_catalog_id(
          id,
          canonical_title,
          award_type,
          provider_family,
          education_type,
          qualification_level
        )
      `)
      .gte("readiness_score", minReadiness)
      .in("status", ["ready", "promoted"])
      .order("readiness_score", { ascending: false })
      .limit(100);

    return json(200, {
      ok: !error,
      drafts: (data || []).map((d: any) => ({
        draft_id: d.id,
        draft_title: d.draft_title,
        readiness_score: d.readiness_score,
        status: d.status,
        award_type: d.qualification_catalog?.award_type,
        provider_family: d.qualification_catalog?.provider_family,
        education_type: d.qualification_catalog?.education_type,
        qualification_level: d.qualification_catalog?.qualification_level,
      })),
    }, origin);
  }

  // --- WAVE CANDIDATES ---
  if (action === "wave_candidates") {
    const { data, error } = await sb
      .from("qualification_wave_candidates")
      .select(`
        *,
        qualification_catalog:qualification_catalog_id(canonical_title, award_type, provider_family),
        draft:draft_id(draft_title, readiness_score)
      `)
      .order("promotion_priority", { ascending: false })
      .limit(100);

    return json(200, { ok: !error, candidates: data || [] }, origin);
  }

  // --- RUN CRON ---
  if (action === "run_cron") {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const res = await fetch(`${supabaseUrl}/functions/v1/qualification-intake-cron`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        discovery: true,
        fetch: true,
        parse: true,
        draft: true,
        materialize: true,
        wave_sync: true,
      }),
    });

    const data = await res.json().catch(() => null);
    return json(200, { ok: res.ok, result: data }, origin);
  }

  // --- BUILD DRAFTS (placeholder) ---
  if (action === "build_drafts") {
    return json(200, { ok: true, built: 0, message: "build_drafts not yet implemented" }, origin);
  }

  return json(400, { error: `Unknown action: ${action}` }, origin);
});
