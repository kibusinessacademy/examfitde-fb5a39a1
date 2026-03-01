import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[BERUFSKI-EMAIL-FLUSH] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not set");

    const fromAddress = Deno.env.get("RESEND_FROM") || "BerufsKI <noreply@berufski.de>";
    const replyTo = Deno.env.get("RESEND_REPLY_TO") || "likeitmark9@gmail.com";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch queued emails (max 10 per flush)
    const { data: queued, error: fetchErr } = await adminClient
      .from('berufski_email_outbox')
      .select('*')
      .eq('status', 'queued')
      .order('created_at')
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!queued?.length) {
      logStep("No queued emails");
      return json(200, { ok: true, sent: 0 }, origin);
    }

    logStep("Processing queued emails", { count: queued.length });
    let sentCount = 0;

    for (const email of queued) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [email.to_email],
            reply_to: replyTo,
            subject: email.subject,
            html: email.html,
          }),
        });

        if (res.ok) {
          await adminClient.from('berufski_email_outbox').update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          }).eq('id', email.id);
          sentCount++;
          logStep("Email sent", { to: email.to_email, id: email.id });
        } else {
          const errText = await res.text().catch(() => '');
          await adminClient.from('berufski_email_outbox').update({
            status: 'failed',
            error: `${res.status}: ${errText}`.slice(0, 500),
          }).eq('id', email.id);
          logStep("Email send failed", { to: email.to_email, status: res.status });
        }
      } catch (e) {
        await adminClient.from('berufski_email_outbox').update({
          status: 'failed',
          error: String(e).slice(0, 500),
        }).eq('id', email.id);
        logStep("Email error", { to: email.to_email, error: String(e) });
      }
    }

    logStep("Flush complete", { sent: sentCount, total: queued.length });
    return json(200, { ok: true, sent: sentCount, total: queued.length }, origin);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json(500, { ok: false, error: msg }, origin);
  }
});
