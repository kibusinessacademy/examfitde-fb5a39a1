import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    const email = String(body.email ?? "").trim().toLowerCase();
    const curriculumId = body.curriculum_id as string | null;
    const source = String(body.source ?? "unknown");
    const intent = String(body.intent ?? "unknown");

    if (!email || !isValidEmail(email)) {
      return jsonResponse({ ok: false, error: "Ungültige E-Mail-Adresse." }, 400, origin);
    }

    const { data, error } = await sb.rpc("capture_lead", {
      p_email: email,
      p_curriculum_id: curriculumId,
      p_source: source,
      p_intent: intent,
    });

    if (error) throw error;

    return jsonResponse({ ok: true, lead_id: data }, 200, origin);
  } catch (error) {
    // Keep full error details server-side only; never echo to caller.
    console.error("[capture-lead] error:", error);
    return jsonResponse(
      { ok: false, error: "Ein Fehler ist aufgetreten. Bitte später erneut versuchen." },
      500,
      origin,
    );
  }
});
