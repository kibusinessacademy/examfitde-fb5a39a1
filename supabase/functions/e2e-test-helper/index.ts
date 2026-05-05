/**
 * e2e-test-helper
 * ────────────────
 * Token-gated proxy so Sandbox/CI E2E specs do not need the
 * SUPABASE_SERVICE_ROLE_KEY (or any SUPABASE_* secret).
 *
 * Auth: Bearer <E2E_HELPER_TOKEN> (shared secret stored in Lovable runtime).
 *
 * Whitelisted operations:
 *   { op: "sellable_courses" }
 *   { op: "create_test_grant", course_id, email, reason? }
 *   { op: "ping" }
 *
 * Internally uses SUPABASE_SERVICE_ROLE_KEY (auto-injected in Edge Functions).
 * No client ever sees the service role key.
 */
// @ts-expect-error Deno remote
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELPER_TOKEN = Deno.env.get("E2E_HELPER_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  if (!HELPER_TOKEN) return json(500, { error: "helper_token_not_configured" });
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.replace(/^Bearer\s+/i, "").trim();
  if (presented !== HELPER_TOKEN) return json(401, { error: "unauthorized" });

  let payload: any = {};
  try { payload = await req.json(); } catch { /* allow empty */ }
  const op = String(payload?.op ?? "");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (op === "ping") return json(200, { ok: true, ts: Date.now() });

    if (op === "sellable_courses") {
      const { data, error } = await admin.rpc("public_sellable_courses");
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, courses: data ?? [] });
    }

    if (op === "create_test_grant") {
      const course_id = String(payload?.course_id ?? "");
      const email = String(payload?.email ?? "");
      const reason = String(payload?.reason ?? "e2e-test-helper");
      if (!course_id || !email) return json(400, { error: "course_id+email required" });
      if (!/@examfit-smoke\.local$/i.test(email)) {
        return json(400, { error: "email must end with @examfit-smoke.local" });
      }
      const { data, error } = await admin.rpc("admin_create_test_purchase_grant", {
        _course_id: course_id, _user_email: email, _reason: reason,
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, grant: data });
    }

    return json(400, { error: "unknown_op", op });
  } catch (e) {
    return json(500, { error: String((e as Error).message ?? e) });
  }
});
