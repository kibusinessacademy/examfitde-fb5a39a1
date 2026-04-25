// Edge Function: exam-pool-root-cause
// Wraps fn_diagnose_exam_pool_deficit + fn_autofix_exam_pool_deficit
// für sichere admin-only Aufrufe aus dem Frontend.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    // Verify caller is admin via RLS-aware client using their JWT
    const authHdr = req.headers.get("authorization") || "";
    if (!authHdr.startsWith("Bearer ")) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHdr } },
      auth: { persistSession: false },
    });

    const { data: userResult } = await userClient.auth.getUser();
    if (!userResult?.user) return json({ ok: false, error: "unauthorized" }, 401);

    const { data: isAdmin } = await userClient.rpc("has_role", {
      _user_id: userResult.user.id,
      _role: "admin",
    });
    if (isAdmin !== true) return json({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const { package_id, mode } = body as { package_id?: string; mode?: "diagnose" | "autofix" };

    if (!package_id || typeof package_id !== "string") {
      return json({ ok: false, error: "package_id required" }, 400);
    }
    const action = mode === "autofix" ? "autofix" : "diagnose";

    // Use service-role for the actual RPC (function is locked-down)
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    if (action === "diagnose") {
      const { data, error } = await sb.rpc("fn_diagnose_exam_pool_deficit", { p_package_id: package_id });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json(data ?? { ok: false, error: "no_diagnosis" });
    }

    // Autofix
    const { data, error } = await sb.rpc("fn_autofix_exam_pool_deficit", { p_package_id: package_id });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json(data ?? { ok: false, error: "no_result" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return json({ ok: false, error: msg }, 500);
  }
});
