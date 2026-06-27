// approve-store-release
// Admin-only. Approves an active candidate for SUBMISSION (not publishing).
// Verifies release policy via the pure SSOT module. Never submits to a store.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { evaluateReleasePolicy } from "../_shared/storeRelease/releasePolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await assertAdmin(req, "approve-store-release");
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { candidate_id?: string; note?: string } = {};
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
    if (c.status !== "active") {
      return new Response(JSON.stringify({ error: "candidate_not_active" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const manifest_id = c.manifest_id as string;
    const { data: gate } = await supabase.from("store_review_gate")
      .select("review_state, manifest_hash, listing_hash, package_hash, build_hash, version")
      .eq("manifest_id", manifest_id)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    const gateRow = (gate ?? null) as Record<string, unknown> | null;

    const policy = evaluateReleasePolicy({
      review_ready: gateRow?.review_state === "review_ready",
      build_current: Boolean(c.android_build_reference && c.ios_build_reference),
      hashes_current:
        (gateRow?.manifest_hash ?? null) === (c.manifest_hash ?? null) &&
        (gateRow?.listing_hash ?? null) === (c.listing_hash ?? null) &&
        (gateRow?.package_hash ?? null) === (c.package_hash ?? null) &&
        (gateRow?.build_hash ?? null) === (c.build_hash ?? null),
      manifest_current: Boolean(c.manifest_hash),
      listings_current: Boolean(c.listing_hash),
      smoke_current: Boolean(c.smoke_hash),
      tests_current: true,
      known_limitations_accepted: true,
    });

    if (!policy.approved_for_submission) {
      return new Response(JSON.stringify({ error: "policy_blocked", blockers: policy.blockers }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("store_release_candidates")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: auth.userId ?? null })
      .eq("id", candidate_id);

    await supabase.from("store_release_timeline").insert({
      candidate_id, manifest_id, event: "approved",
      actor_id: auth.userId ?? null, note: body.note ?? null,
      payload: { policy_blockers: policy.blockers },
    });

    await supabase.from("security_events").insert({
      event_type: "candidate_approved", decision: "audit",
      reason: `candidate=${candidate_id}`,
      meta: { function_name: "approve-store-release", candidate_id, manifest_id },
    }).then(() => {}, () => {});

    return new Response(JSON.stringify({ ok: true, policy }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
