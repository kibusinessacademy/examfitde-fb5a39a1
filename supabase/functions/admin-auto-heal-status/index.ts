import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: require admin JWT
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "missing_bearer_token" }, 401);
    }

    const jwt = authHeader.replace("Bearer ", "");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE_ROLE;

    const userClient = createClient(SUPABASE_URL, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const { data: role } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!role) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    // Fetch data server-side
    const [runsRes, policyRes] = await Promise.all([
      sb.from("autofix_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
      sb.from("auto_heal_policies")
        .select("*")
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    return json({
      ok: true,
      runs: runsRes.data ?? [],
      policy: policyRes.data ?? null,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? "unknown_error";
    console.error("[admin-auto-heal-status] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
