// Newsletter Double-Optin: Step 2 — confirm token
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const url = new URL(req.url);
    const token =
      url.searchParams.get("token") ||
      (req.method !== "GET" ? (await req.json()).token : null);

    if (!token) return json({ ok: false, error: "Missing token" }, 400);

    const { data, error } = await sb.rpc("confirm_doi_token", { p_token: token });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ok) {
      return json({ ok: false, error: "Token ungültig oder abgelaufen." }, 410);
    }

    return json({ ok: true, email: row.email, contact_id: row.contact_id });
  } catch (err) {
    console.error("[newsletter-doi-confirm] error:", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown" },
      500
    );
  }
});
