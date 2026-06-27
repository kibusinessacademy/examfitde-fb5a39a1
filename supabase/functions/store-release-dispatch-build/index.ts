// store-release-dispatch-build
//
// Admin-only dispatcher. Verifies the caller is an admin (via assertAdmin),
// loads the manifest, writes a `queued` row into store_release_builds, and
// triggers the corresponding GitHub workflow via repository_dispatch.
//
// The GitHub Personal Access Token is read from GITHUB_DISPATCH_TOKEN env;
// it never leaves the edge function. If the token is not configured the
// queued row is still written and the response indicates manual_trigger_required.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

const WORKFLOW_FILE = {
  android: "store-build-android.yml",
  ios: "store-build-ios.yml",
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const gate = await assertAdmin(req, "store-release-dispatch-build");
  if (!gate.ok) return json({ error: gate.reason }, gate.status);

  const body = await req.json().catch(() => ({}));
  const { manifest_id, platform, dry_run = true } = body ?? {};
  if (!manifest_id || !platform || !["android", "ios"].includes(platform)) {
    return json({ error: "manifest_id + platform (android|ios) required" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: manifest, error: mErr } = await sb
    .from("mobile_course_app_manifest")
    .select("id, course_id, product_id, curriculum_id, build_number")
    .eq("id", manifest_id)
    .maybeSingle();
  if (mErr || !manifest) return json({ error: "manifest not found" }, 404);

  // Write queued row immediately (so the Center reflects intent even if
  // workflow dispatch is skipped because the GitHub token is not configured).
  const { data: queued, error: qErr } = await sb
    .from("store_release_builds")
    .insert({
      manifest_id,
      platform,
      stage: "queued",
      status: "ok",
      dry_run: dry_run !== false,
      requested_by: gate.userId,
    })
    .select()
    .single();
  if (qErr) return json({ error: qErr.message }, 500);

  const ghToken = Deno.env.get("GITHUB_DISPATCH_TOKEN");
  const ghRepo = Deno.env.get("GITHUB_DISPATCH_REPO"); // "owner/repo"
  const ghRef = Deno.env.get("GITHUB_DISPATCH_REF") || "main";

  if (!ghToken || !ghRepo) {
    return json({
      ok: true,
      queued_id: queued.id,
      dispatch: "manual_required",
      reason: "GITHUB_DISPATCH_TOKEN / GITHUB_DISPATCH_REPO not configured",
    });
  }

  const workflow = WORKFLOW_FILE[platform as "android" | "ios"];
  const inputs = {
    manifest_id: String(manifest.id),
    course_id: String(manifest.course_id ?? ""),
    product_id: String(manifest.product_id ?? ""),
    curriculum_id: String(manifest.curriculum_id ?? ""),
    build_number: String(manifest.build_number ?? ""),
    dry_run: dry_run !== false ? "true" : "false",
  };

  const res = await fetch(
    `https://api.github.com/repos/${ghRepo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: ghRef, inputs }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ ok: false, queued_id: queued.id, dispatch_error: res.status, detail: text.slice(0, 300) }, 502);
  }

  return json({ ok: true, queued_id: queued.id, dispatch: "workflow_dispatched", workflow, dry_run: dry_run !== false });
});
