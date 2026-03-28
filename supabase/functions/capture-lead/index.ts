import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    const email = String(body.email ?? "").trim().toLowerCase();
    const curriculumId = body.curriculum_id as string | null;
    const source = String(body.source ?? "unknown");
    const intent = String(body.intent ?? "unknown");

    if (!email || !isValidEmail(email)) {
      return jsonResponse({ ok: false, error: "Ungültige E-Mail-Adresse." }, 400);
    }

    const { data, error } = await sb.rpc("capture_lead", {
      p_email: email,
      p_curriculum_id: curriculumId,
      p_source: source,
      p_intent: intent,
    });

    if (error) throw error;

    return jsonResponse({ ok: true, lead_id: data });
  } catch (error) {
    console.error("[capture-lead] error:", error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});
