import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[BERUFSKI-EMAIL-FLUSH] ${step}`, details ? JSON.stringify(details) : '');
};

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return !!(token && srk && token === srk);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not set");

    const fromAddress = Deno.env.get("RESEND_FROM") || "BerufsKI <noreply@berufski.de>";
    const replyTo = Deno.env.get("RESEND_REPLY_TO") || "likeitmark9@gmail.com";

    const { data: emails } = await admin
      .from("berufski_email_outbox")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(25);

    if (!emails?.length) {
      logStep("No queued emails");
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logStep("Processing queued emails", { count: emails.length });
    let sent = 0;
    let failed = 0;

    for (const e of emails) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [e.to_email],
            reply_to: replyTo,
            subject: e.subject,
            html: e.html,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Resend error ${res.status}: ${errText}`);
        }

        await admin.from("berufski_email_outbox").update({
          status: "sent",
          sent_at: new Date().toISOString(),
        }).eq("id", e.id);
        sent++;
        logStep("Email sent", { to: e.to_email, id: e.id });
      } catch (err) {
        await admin.from("berufski_email_outbox").update({
          status: "failed",
          error: String(err).slice(0, 500),
        }).eq("id", e.id);
        failed++;
        logStep("Email error", { to: e.to_email, error: String(err) });
      }
    }

    logStep("Flush complete", { sent, failed });
    return new Response(JSON.stringify({ ok: true, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
