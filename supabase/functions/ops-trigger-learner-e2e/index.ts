import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Rate-limit: max 1 bad-credentials notification per hour
let lastBadCredNotification = 0;

async function notifyBadGitHubToken(reason: string) {
  const now = Date.now();
  if (now - lastBadCredNotification < 3600_000) return; // 1h cooldown
  lastBadCredNotification = now;
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await sb.from("admin_notifications").insert({
      title: "⚠️ GitHub E2E Token invalid",
      body: `GITHUB_E2E_TOKEN returned: ${reason}. E2E dispatch is non-blocking but tests won't run. Update the secret.`,
      severity: "warning",
      category: "ops",
      entity_type: "system",
      entity_id: "github_e2e_token",
    });
  } catch (e) {
    console.warn("[ops-trigger-learner-e2e] Failed to insert bad-cred notification:", e);
  }
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "Use POST" }, origin);

  // ── Auth: internal-only (job-runner key) ──
  const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const callerKey = req.headers.get("x-job-runner-key") ?? "";
  if (!internalSecret || !callerKey || callerKey !== internalSecret) {
    return json(401, { error: "Unauthorized" }, origin);
  }

  // ── Env ──
  const GITHUB_TOKEN = Deno.env.get("GITHUB_E2E_TOKEN") ?? "";
  const GITHUB_OWNER = Deno.env.get("GITHUB_OWNER") ?? "";
  const GITHUB_REPO = Deno.env.get("GITHUB_REPO") ?? "";
  const BASE_URL = Deno.env.get("E2E_BASE_URL") ?? "";
  const E2E_TEST_USER_EMAIL = Deno.env.get("E2E_TEST_USER_EMAIL") ?? "";
  const E2E_TEST_USER_PASSWORD = Deno.env.get("E2E_TEST_USER_PASSWORD") ?? "";

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO || !BASE_URL) {
    console.error("[ops-trigger-learner-e2e] Missing env: GITHUB_E2E_TOKEN, GITHUB_OWNER, GITHUB_REPO, or E2E_BASE_URL");
    return json(500, { error: "Missing GitHub or base URL env" }, origin);
  }

  // ── Body ──
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  const packageId = String(body.package_id ?? body.packageId ?? "");
  const curriculumId = String(body.curriculum_id ?? body.curriculumId ?? "");
  const courseId = String(body.course_id ?? body.courseId ?? "");
  const track = String(body.track ?? "AUSBILDUNG_VOLL");
  const reason = String(body.reason ?? "post_publish");

  if (!packageId || !curriculumId) {
    return json(400, { error: "package_id and curriculum_id required" }, origin);
  }

  // ── GitHub Token Preflight Check ──
  try {
    const checkRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "examfit-ops-trigger",
      },
    });
    const checkBody = await checkRes.text();
    if (checkRes.status === 401 || checkRes.status === 403) {
      console.error(`[ops-trigger-learner-e2e] ❌ GitHub token invalid: ${checkRes.status}`);
      await notifyBadGitHubToken(`HTTP ${checkRes.status} – Bad credentials`);
      // Non-blocking: return success to not block publish pipeline
      return json(200, { ok: true, triggered: false, skip_reason: "github_token_invalid", package_id: packageId }, origin);
    }
  } catch (e) {
    console.warn("[ops-trigger-learner-e2e] GitHub preflight check failed (continuing):", e);
  }

  // ── Dispatch to GitHub Actions ──
  const payload = {
    event_type: "learner_e2e",
    client_payload: {
      package_id: packageId,
      curriculum_id: curriculumId,
      course_id: courseId,
      track,
      reason,
      base_url: BASE_URL,
      test_user_email: E2E_TEST_USER_EMAIL,
      test_user_password: E2E_TEST_USER_PASSWORD,
    },
  };

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "examfit-ops-trigger",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[ops-trigger-learner-e2e] GitHub dispatch failed: ${res.status} ${txt}`);

    if (res.status === 401 || res.status === 403) {
      await notifyBadGitHubToken(`Dispatch HTTP ${res.status}`);
      return json(200, { ok: true, triggered: false, skip_reason: "github_dispatch_auth_fail", package_id: packageId }, origin);
    }

    return json(502, { ok: false, status: res.status, error: txt }, origin);
  }
  await res.text().catch(() => {});

  console.log(`[ops-trigger-learner-e2e] ✅ Dispatched learner_e2e for package=${packageId} reason=${reason}`);
  return json(200, { ok: true, triggered: true, package_id: packageId, curriculum_id: curriculumId, reason }, origin);
});
