// Shared callback helper. Masks errors; never sends secrets.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET = process.env.STORE_RELEASE_STATUS_CALLBACK_SECRET;

export async function report(stage, status, extra = {}) {
  if (!SUPABASE_URL || !SECRET) {
    console.log(`[report] (no callback configured) stage=${stage} status=${status}`);
    return;
  }
  const body = {
    manifest_id: process.env.MANIFEST_ID,
    platform: process.env.PLATFORM,
    workflow_run_id: process.env.GITHUB_RUN_ID || null,
    commit_sha: process.env.GITHUB_SHA || null,
    build_number: process.env.BUILD_NUMBER || null,
    stage,
    status,
    artifact_name: extra.artifact_name || null,
    artifact_url: extra.artifact_url || null,
    error_code: extra.error_code || null,
    metadata_hash: extra.metadata_hash || null,
    metadata: { ...extra },
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/store-release-build-status`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-callback-secret": SECRET },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`[report] non-2xx (${res.status}) for stage=${stage}`);
  } catch (e) {
    console.warn(`[report] callback failed for stage=${stage}: ${(e && e.message) || "network"}`);
  }
}
