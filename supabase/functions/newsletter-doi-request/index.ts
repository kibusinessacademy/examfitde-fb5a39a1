// Newsletter Double-Optin: Step 1 — request DOI mail
// Creates a token via RPC and sends a confirmation email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const PUBLIC_BASE = Deno.env.get("E2E_BASE_URL") || "https://berufos.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const source = String(body.source ?? "footer_optin");
    const curriculum_id = body.curriculum_id ?? null;

    if (!isEmail(email)) {
      return json({ ok: false, error: "Ungültige E-Mail-Adresse." }, 400);
    }

    const { data: token, error } = await sb.rpc("create_doi_token", {
      p_email: email,
      p_source: source,
      p_curriculum_id: curriculum_id,
      p_metadata: body.metadata ?? {},
    });
    if (error) throw error;

    const confirmUrl = `${PUBLIC_BASE}/newsletter/confirm?token=${encodeURIComponent(
      String(token)
    )}`;

    // Best-effort send via Resend (never blocks the flow)
    if (RESEND_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "ExamFit <noreply@berufos.com>",
            to: [email],
            subject: "Bitte bestätige deine E-Mail-Adresse",
            html: `<div style="font-family:system-ui,Arial;line-height:1.5">
              <h2>Fast geschafft!</h2>
              <p>Bitte bestätige deine Anmeldung zum ExamFit Newsletter:</p>
              <p><a href="${confirmUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">E-Mail bestätigen</a></p>
              <p style="color:#666;font-size:12px">Link gültig 7 Tage. Falls du das nicht warst, ignoriere diese E-Mail.</p>
            </div>`,
          }),
        });
      } catch (e) {
        console.warn("[newsletter-doi-request] mail send failed:", e);
      }
    }

    // Funnel event
    await sb.from("conversion_events").insert({
      event_type: "optin_submit",
      metadata: { source, email_hash: email.length },
    });

    return json({ ok: true });
  } catch (err) {
    console.error("[newsletter-doi-request] error:", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown" },
      500
    );
  }
});
