import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" });

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" });

    const body = await req.json().catch(() => ({}));

    // Sanitize allowed fields
    const humor_enabled = typeof body.humor_enabled === "boolean" ? body.humor_enabled : undefined;
    const humor_push_enabled = typeof body.humor_push_enabled === "boolean" ? body.humor_push_enabled : undefined;
    const tone_preference =
      body.tone_preference === "auto" || body.tone_preference === "business" || body.tone_preference === "casual"
        ? body.tone_preference
        : undefined;
    const modernity_range =
      typeof body.modernity_range === "string" && /^\d{1,3}-\d{1,3}$/.test(body.modernity_range)
        ? body.modernity_range
        : undefined;

    // Upsert
    const payload: any = { user_id: userId };
    if (humor_enabled !== undefined) payload.humor_enabled = humor_enabled;
    if (humor_push_enabled !== undefined) payload.humor_push_enabled = humor_push_enabled;
    if (tone_preference !== undefined) payload.tone_preference = tone_preference;
    if (modernity_range !== undefined) payload.modernity_range = modernity_range;

    const { data, error } = await supabase
      .from("user_humor_preferences")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id, humor_enabled, humor_push_enabled, tone_preference, modernity_range")
      .maybeSingle();

    if (error) return json(500, { error: "upsert_failed", details: error.message });

    return json(200, { ok: true, prefs: data });
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) });
  }
});
