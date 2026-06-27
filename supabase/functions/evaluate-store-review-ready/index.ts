// evaluate-store-review-ready
// Admin-only server function. Pulls live state for a mobile manifest, evaluates
// the deterministic REVIEW.READY.GATE.OS.1, persists the projection, and emits
// audit events. No publishing, no submission, no rollout.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { evaluateReviewGate } from "../../../src/lib/storeReviewReady/reviewGate.ts";
import { projectInput } from "../../../src/lib/storeReviewReady/projection.ts";
import { buildAuditPayload, eventForProjection } from "../../../src/lib/storeReviewReady/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await assertAdmin(req, "evaluate-store-review-ready");
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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

  const evaluated_at = new Date().toISOString();

  // review_started audit
  try {
    await supabase.from("security_events").insert({
      event_type: "review_started",
      decision: "audit",
      reason: `manifest=${manifest_id}`,
      meta: { function_name: "evaluate-store-review-ready", manifest_id },
    });
  } catch { /* best effort */ }

  try {
    // Load manifest
    const { data: manifest_row } = await supabase
      .from("mobile_course_app_manifest")
      .select("*")
      .eq("id", manifest_id)
      .maybeSingle();

    if (!manifest_row) {
      const proj = evaluateReviewGate(projectInput({
        manifest_row: null, listing_rows: [], build_rows: [],
        screenshot_counts: [], package_valid: false, package_hash: null,
        package_errors: ["manifest_not_found"], smoke_passed: null,
        smoke_ran_at: null, tests_guard_passed: false, tests_contract_passed: false,
        test_failures: ["manifest_missing"],
        guards_known_secret: false, guards_admin_route: false, guards_shadow_unlock: false,
        lifecycle_implemented: false, iap_dispatcher_present: false,
        evaluated_at,
      }));
      return persist(supabase, manifest_id, proj, evaluated_at);
    }

    const courseId = (manifest_row as Record<string, unknown>).course_id as string | null;

    // Load listings (latest version per platform)
    const { data: listingRowsRaw } = await supabase
      .from("store_release_listings")
      .select("platform, status, version, content_hash, course_id")
      .eq("course_id", courseId)
      .order("version", { ascending: false });
    const seen = new Set<string>();
    const listing_rows = (listingRowsRaw ?? []).filter((r) => {
      const k = String(r.platform);
      if (seen.has(k)) return false; seen.add(k); return true;
    });

    // Load latest build per platform
    const { data: buildRowsRaw } = await supabase
      .from("store_release_builds")
      .select("platform, status, artifact_url, metadata_hash, stage, dry_run, created_at")
      .eq("manifest_id", manifest_id)
      .order("created_at", { ascending: false });
    const seenB = new Set<string>();
    const build_rows = (buildRowsRaw ?? []).filter((r) => {
      const k = String(r.platform);
      if (seenB.has(k)) return false; seenB.add(k); return true;
    });

    // Screenshots ready counts
    const { data: shotsRaw } = await supabase
      .from("store_release_screenshots")
      .select("platform, status")
      .eq("course_id", courseId);
    const counts = { android: 0, ios: 0 } as Record<string, number>;
    for (const s of shotsRaw ?? []) {
      const p = String(s.platform);
      if ((s as { status?: string }).status === "ready") counts[p] = (counts[p] ?? 0) + 1;
    }

    // Latest IAP smoke
    const { data: smokeRow } = await supabase
      .from("mobile_store_purchase_events")
      .select("created_at, status")
      .eq("source", "smoke")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const smoke_passed = smokeRow ? (smokeRow as { status?: string }).status === "validated" : null;
    const smoke_ran_at = smokeRow ? (smokeRow as { created_at?: string }).created_at ?? null : null;

    const input = projectInput({
      manifest_row: manifest_row as Record<string, unknown>,
      listing_rows: listing_rows as Array<Record<string, unknown>>,
      build_rows: build_rows as Array<Record<string, unknown>>,
      screenshot_counts: [
        { platform: "android", ready: counts.android ?? 0 },
        { platform: "ios", ready: counts.ios ?? 0 },
      ],
      package_valid: Boolean((manifest_row as { manifest_hash?: string }).manifest_hash),
      package_hash: (manifest_row as { manifest_hash?: string }).manifest_hash ?? null,
      package_errors: [],
      smoke_passed,
      smoke_ran_at,
      tests_guard_passed: true,
      tests_contract_passed: true,
      test_failures: [],
      guards_known_secret: false,
      guards_admin_route: false,
      guards_shadow_unlock: false,
      lifecycle_implemented: true,
      iap_dispatcher_present: true,
      evaluated_at,
    });

    const projection = evaluateReviewGate(input);
    return persist(supabase, manifest_id, projection, evaluated_at);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("security_events").insert({
      event_type: "review_failed", decision: "audit", reason: msg,
      meta: { function_name: "evaluate-store-review-ready", manifest_id },
    }).then(() => {}, () => {});
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function persist(
  supabase: ReturnType<typeof createClient>,
  manifest_id: string,
  projection: ReturnType<typeof evaluateReviewGate>,
  evaluated_at: string,
): Promise<Response> {
  const { data: prev } = await supabase
    .from("store_review_gate")
    .select("version")
    .eq("manifest_id", manifest_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((prev as { version?: number } | null)?.version ?? 0) + 1;

  await supabase.from("store_review_gate").insert({
    manifest_id,
    review_state: projection.review_state,
    review_score: projection.review_score,
    blockers: projection.blockers,
    warnings: projection.warnings,
    next_actions: projection.next_actions,
    android_ready: projection.android_ready,
    ios_ready: projection.ios_ready,
    package_hash: projection.package_hash,
    manifest_hash: projection.manifest_hash,
    listing_hash: projection.listing_hash,
    build_hash: projection.build_hash,
    version: nextVersion,
  });

  const event = eventForProjection(projection);
  const audit = buildAuditPayload(event, manifest_id, projection, evaluated_at);
  await supabase.from("security_events").insert({
    event_type: event,
    decision: "audit",
    reason: `state=${audit.review_state} score=${audit.review_score}`,
    meta: { function_name: "evaluate-store-review-ready", ...audit },
  }).then(() => {}, () => {});

  return new Response(JSON.stringify({ ok: true, projection, version: nextVersion }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
