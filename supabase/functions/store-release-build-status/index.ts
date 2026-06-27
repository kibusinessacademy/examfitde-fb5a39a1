// store-release-build-status
//
// Callback endpoint for the store-build-android / store-build-ios workflows.
// Verifies the shared callback secret, validates stage/platform, and appends a
// row to store_release_builds. NEVER persists or echoes any incoming secrets.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-callback-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

const ALLOWED_PLATFORMS = new Set(["android", "ios"]);
const ALLOWED_STAGES = new Set([
  "queued",
  "package_validated",
  "build_started",
  "build_succeeded",
  "build_failed",
  "signing_skipped",
  "signing_succeeded",
  "upload_skipped",
  "upload_succeeded",
  "upload_failed",
  "missing_secrets",
]);
const FORBIDDEN_META_KEYS = [
  "ANDROID_KEYSTORE_BASE64","ANDROID_KEYSTORE_PASSWORD","ANDROID_KEY_PASSWORD",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON","APP_STORE_CONNECT_API_KEY_BASE64",
  "IOS_CERTIFICATE_BASE64","IOS_CERTIFICATE_PASSWORD","IOS_PROVISIONING_PROFILE_BASE64",
  "STORE_RELEASE_STATUS_CALLBACK_SECRET","GITHUB_TOKEN","SUPABASE_SERVICE_ROLE_KEY",
];

function constantEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function stripSecrets(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (FORBIDDEN_META_KEYS.includes(k)) continue;
    if (typeof v === "string" && /-----BEGIN [A-Z ]+-----/.test(v)) continue;
    out[k] = v;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const expected = Deno.env.get("STORE_RELEASE_STATUS_CALLBACK_SECRET") ?? "";
  const got = req.headers.get("x-callback-secret") ?? "";
  if (!expected || !constantEq(expected, got)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const { manifest_id, platform, stage } = body ?? {};
  if (!manifest_id || typeof manifest_id !== "string") return json({ error: "manifest_id required" }, 400);
  if (!ALLOWED_PLATFORMS.has(platform)) return json({ error: "invalid platform" }, 400);
  if (!ALLOWED_STAGES.has(stage)) return json({ error: "invalid stage" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Verify manifest exists (read-only)
  const { data: manifest, error: mErr } = await sb
    .from("mobile_course_app_manifest")
    .select("id")
    .eq("id", manifest_id)
    .maybeSingle();
  if (mErr || !manifest) return json({ error: "manifest not found" }, 404);

  const safeMeta = stripSecrets(body.metadata ?? {});

  const { error } = await sb.from("store_release_builds").insert({
    manifest_id,
    platform,
    workflow_run_id: body.workflow_run_id ?? null,
    commit_sha: body.commit_sha ?? null,
    build_number: body.build_number ? Number(body.build_number) : null,
    stage,
    status: body.status ?? "ok",
    artifact_name: body.artifact_name ?? null,
    artifact_url: body.artifact_url ?? null,
    metadata_hash: body.metadata_hash ?? null,
    error_code: body.error_code ?? null,
    dry_run: body.dry_run !== false,
  });
  if (error) return json({ error: error.message }, 500);

  // Best-effort audit (non-fatal).
  await sb.from("security_events").insert({
    event_type: "store_release_build_status",
    decision: "log",
    reason: stage,
    meta: { manifest_id, platform, stage, ...safeMeta },
  }).then(() => {}).catch(() => {});

  return json({ ok: true });
});
