// create-store-release-candidate
// Admin-only. Creates a new release candidate snapshot for a manifest, captures
// hash fingerprints, and appends a candidate_created event.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { buildReleaseCandidate } from "../_shared/storeRelease/releaseCandidate.ts";
import { buildReleaseAuditPayload } from "../_shared/storeRelease/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await assertAdmin(req, "create-store-release-candidate");
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { manifest_id?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const manifest_id = typeof body.manifest_id === "string" ? body.manifest_id : null;
  if (!manifest_id) {
    return new Response(JSON.stringify({ error: "manifest_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: m } = await supabase.from("mobile_course_app_manifest")
      .select("*").eq("id", manifest_id).maybeSingle();
    if (!m) {
      return new Response(JSON.stringify({ error: "manifest_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const manifest = m as Record<string, unknown>;
    const courseId = (manifest.course_id ?? null) as string | null;

    // Latest review gate must be review_ready
    const { data: gate } = await supabase.from("store_review_gate")
      .select("review_state, manifest_hash, listing_hash, package_hash, build_hash, version")
      .eq("manifest_id", manifest_id)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (!gate || (gate as { review_state?: string }).review_state !== "review_ready") {
      return new Response(JSON.stringify({ error: "review_not_ready" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Latest builds
    const { data: builds } = await supabase.from("store_release_builds")
      .select("platform, artifact_url, metadata_hash")
      .eq("manifest_id", manifest_id)
      .order("created_at", { ascending: false }).limit(10);
    const android = (builds ?? []).find((b) => String((b as { platform?: string }).platform) === "android");
    const ios = (builds ?? []).find((b) => String((b as { platform?: string }).platform) === "ios");

    // Latest smoke
    const { data: smoke } = await supabase.from("mobile_store_purchase_events")
      .select("id, created_at").eq("source", "smoke")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    // Invalidate any active candidate for this manifest
    await supabase.from("store_release_candidates")
      .update({ status: "invalidated", invalidated_reason: "superseded_by_new_candidate", invalidated_at: new Date().toISOString() })
      .eq("manifest_id", manifest_id).eq("status", "active");

    const { data: prev } = await supabase.from("store_release_candidates")
      .select("candidate_version").eq("manifest_id", manifest_id)
      .order("candidate_version", { ascending: false }).limit(1).maybeSingle();
    const candidateVersion = ((prev as { candidate_version?: number } | null)?.candidate_version ?? 0) + 1;

    const candidate = buildReleaseCandidate({
      manifest_id,
      product_id: (manifest.product_id ?? null) as string | null,
      curriculum_id: (manifest.curriculum_id ?? null) as string | null,
      course_id: courseId,
      version: String(manifest.version_name ?? "0.0.0"),
      build_number: (manifest.build_number ?? null) as string | null,
      android_build_reference: (android as { artifact_url?: string } | undefined)?.artifact_url ?? null,
      ios_build_reference: (ios as { artifact_url?: string } | undefined)?.artifact_url ?? null,
      smoke_version: (smoke as { id?: string } | null)?.id ?? null,
      review_gate_version: String((gate as { version?: number }).version ?? ""),
      hashes: {
        manifest_hash: (gate as { manifest_hash?: string }).manifest_hash ?? null,
        listing_hash: (gate as { listing_hash?: string }).listing_hash ?? null,
        package_hash: (gate as { package_hash?: string }).package_hash ?? null,
        build_hash: (gate as { build_hash?: string }).build_hash ?? null,
        review_hash: String((gate as { version?: number }).version ?? ""),
        smoke_hash: (smoke as { id?: string } | null)?.id ?? null,
      },
      created_at_reference: new Date().toISOString(),
    });

    const { data: inserted, error: insErr } = await supabase.from("store_release_candidates").insert({
      manifest_id,
      product_id: candidate.product_id,
      curriculum_id: candidate.curriculum_id,
      course_id: candidate.course_id,
      version: candidate.version,
      build_number: candidate.build_number,
      candidate_version: candidateVersion,
      status: "active",
      manifest_hash: candidate.package_hash, // fingerprint of manifest+package state
      listing_hash: candidate.listing_hash,
      package_hash: candidate.package_hash,
      build_hash: (gate as { build_hash?: string }).build_hash ?? null,
      review_hash: candidate.review_gate_version,
      smoke_hash: candidate.smoke_version,
      android_build_reference: candidate.android_build_reference,
      ios_build_reference: candidate.ios_build_reference,
      review_gate_version: candidate.review_gate_version,
      smoke_version: candidate.smoke_version,
      created_by: auth.userId ?? null,
    }).select("id").maybeSingle();
    if (insErr) throw insErr;
    const candidateId = (inserted as { id?: string } | null)?.id ?? null;

    await supabase.from("store_release_timeline").insert({
      candidate_id: candidateId, manifest_id, event: "candidate_created",
      actor_id: auth.userId ?? null, payload: { candidate_version: candidateVersion, version: candidate.version },
    });

    const audit = buildReleaseAuditPayload("candidate_created", candidateId, candidate, new Date().toISOString());
    await supabase.from("security_events").insert({
      event_type: "candidate_created", decision: "audit",
      reason: `candidate=${candidateId} manifest=${manifest_id}`,
      meta: { function_name: "create-store-release-candidate", ...audit },
    }).then(() => {}, () => {});

    return new Response(JSON.stringify({ ok: true, candidate_id: candidateId, candidate_version: candidateVersion }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
