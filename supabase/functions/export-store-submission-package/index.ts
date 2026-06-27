// export-store-submission-package
// Admin-only. Aggregates the approved candidate's artifacts into a single JSON
// manifest the human reviewer can hand off to App Store Connect / Play Console
// MANUALLY. This function does NOT call any store APIs.
//
// Hard guards: no submitForReview, no appStoreVersionReleaseRequest, no Production track,
// no Google production publish, no rollout. The function only assembles references.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await assertAdmin(req, "export-store-submission-package");
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { candidate_id?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const candidate_id = typeof body.candidate_id === "string" ? body.candidate_id : null;
  if (!candidate_id) {
    return new Response(JSON.stringify({ error: "candidate_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: cand } = await supabase.from("store_release_candidates")
      .select("*").eq("id", candidate_id).maybeSingle();
    if (!cand) {
      return new Response(JSON.stringify({ error: "candidate_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const c = cand as Record<string, unknown>;
    if (c.status !== "approved") {
      return new Response(JSON.stringify({ error: "candidate_not_approved" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const manifest_id = c.manifest_id as string;
    const course_id = c.course_id as string | null;

    const [manifest, listings, screenshots, builds, gate, timeline] = await Promise.all([
      supabase.from("mobile_course_app_manifest").select("*").eq("id", manifest_id).maybeSingle(),
      supabase.from("store_release_listings").select("*").eq("course_id", course_id),
      supabase.from("store_release_screenshots").select("*").eq("course_id", course_id),
      supabase.from("store_release_builds").select("*").eq("manifest_id", manifest_id),
      supabase.from("store_review_gate").select("*").eq("manifest_id", manifest_id)
        .order("version", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("store_release_timeline").select("*").eq("candidate_id", candidate_id)
        .order("occurred_at", { ascending: true }),
    ]);

    const submission_package = {
      generated_at: new Date().toISOString(),
      candidate: c,
      manifest_snapshot: manifest.data,
      listings: listings.data ?? [],
      screenshots: (screenshots.data ?? []).map((s) => {
        const row = s as Record<string, unknown>;
        // Strip any potential secret-bearing columns defensively
        const { api_key: _a, secret: _s, ...safe } = row;
        return safe;
      }),
      release_notes: (manifest.data as Record<string, unknown> | null)?.release_notes ?? null,
      privacy_url: (manifest.data as Record<string, unknown> | null)?.privacy_url ?? null,
      support_url: (manifest.data as Record<string, unknown> | null)?.support_url ?? null,
      hashes: {
        manifest_hash: c.manifest_hash, listing_hash: c.listing_hash,
        package_hash: c.package_hash, build_hash: c.build_hash,
        review_hash: c.review_hash, smoke_hash: c.smoke_hash,
      },
      review_report: gate.data ?? null,
      review_ready_report: {
        state: (gate.data as { review_state?: string } | null)?.review_state ?? null,
        score: (gate.data as { review_score?: number } | null)?.review_score ?? null,
        blockers: (gate.data as { blockers?: unknown[] } | null)?.blockers ?? [],
      },
      builds: (builds.data ?? []).map((b) => {
        const row = b as Record<string, unknown>;
        const { signing_key: _k, ...safe } = row;
        return safe;
      }),
      known_limitations: {
        no_production_publish: true,
        no_review_submission_api: true,
        rollout_is_human: true,
      },
      timeline: timeline.data ?? [],
    };

    await supabase.from("store_release_candidates")
      .update({ status: "exported", exported_at: new Date().toISOString() })
      .eq("id", candidate_id);

    await supabase.from("store_release_timeline").insert({
      candidate_id, manifest_id, event: "submission_exported",
      actor_id: auth.userId ?? null,
      payload: { hashes: submission_package.hashes },
    });

    await supabase.from("security_events").insert({
      event_type: "submission_exported", decision: "audit",
      reason: `candidate=${candidate_id}`,
      meta: { function_name: "export-store-submission-package", candidate_id, manifest_id },
    }).then(() => {}, () => {});

    return new Response(JSON.stringify({ ok: true, submission_package }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
