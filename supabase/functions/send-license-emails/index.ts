// Deno.serve is built-in
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[SEND-LICENSE-EMAILS] ${step}`, details ? JSON.stringify(details) : '');
};

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: only buyer or admin can trigger
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) throw new Error("Not authenticated");

    const { package_id } = await req.json();
    if (!package_id) throw new Error("Missing package_id");

    // Get package and verify buyer ownership
    const { data: pkg, error: pkgError } = await adminClient
      .from('license_packages')
      .select('*')
      .eq('id', package_id)
      .single();

    if (pkgError || !pkg) throw new Error("Package not found");
    if (pkg.buyer_user_id !== user.id) throw new Error("Not authorized");

    // Get unassigned seats with invite codes
    const { data: seats, error: seatsError } = await adminClient
      .from('license_seats')
      .select('id, invite_code, invite_email, invite_email_hash, invite_expires_at')
      .eq('package_id', package_id)
      .is('assigned_user_id', null)
      .not('invite_code', 'is', null);

    if (seatsError) throw new Error("Failed to fetch seats");
    if (!seats || seats.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No unassigned seats to send" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const resend = new Resend(resendKey);
    const deliveryLog: Array<Record<string, unknown>> = [];
    let sentCount = 0;

    // Get curriculum title for email
    const { data: curriculum } = await adminClient
      .from('curricula')
      .select('title')
      .eq('id', pkg.curriculum_id)
      .maybeSingle();

    const curriculumTitle = curriculum?.title || 'Prüfungsvorbereitung';
    const appUrl = "https://examfitde.lovable.app";

    for (const seat of seats) {
      if (!seat.invite_email) {
        deliveryLog.push({ seat_id: seat.id, status: 'skipped', reason: 'no invite_email' });
        continue;
      }

      try {
        const claimUrl = `${appUrl}/claim?code=${seat.invite_code}`;
        const expiresInfo = seat.invite_expires_at
          ? `Dieser Einladungslink ist gültig bis ${new Date(seat.invite_expires_at).toLocaleDateString('de-DE')}.`
          : '';

        await resend.emails.send({
          from: "ExamFit <noreply@berufos.com>",
          to: [seat.invite_email],
          subject: `Ihre Lizenz für ${curriculumTitle} – ExamFit`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #1a1a2e;">Ihre ExamFit Lizenz</h1>
              <p>Guten Tag,</p>
              <p>Sie haben eine Lizenz für <strong>${curriculumTitle}</strong> erhalten.</p>
              <p>Klicken Sie auf den Button, um Ihren Zugang zu aktivieren:</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${claimUrl}" 
                   style="background-color: #4f46e5; color: white; padding: 14px 28px; 
                          text-decoration: none; border-radius: 8px; font-weight: bold;">
                  Lizenz aktivieren
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">
                Oder geben Sie diesen Code manuell ein: <strong>${seat.invite_code}</strong>
              </p>
              ${expiresInfo ? `<p style="color: #666; font-size: 14px;">${expiresInfo}</p>` : ''}
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
              <p style="color: #999; font-size: 12px;">ExamFit – Prüfungsvorbereitung mit System</p>
            </div>
          `,
        });

        deliveryLog.push({ seat_id: seat.id, email: seat.invite_email, status: 'sent', sent_at: new Date().toISOString() });
        sentCount++;
        logStep("Email sent", { seatId: seat.id, email: seat.invite_email });
      } catch (emailErr) {
        const errMsg = emailErr instanceof Error ? emailErr.message : String(emailErr);
        deliveryLog.push({ seat_id: seat.id, email: seat.invite_email, status: 'failed', error: errMsg });
        logStep("Email send failed", { seatId: seat.id, error: errMsg });
      }
    }

    // Update delivery log on package
    const existingLog = Array.isArray(pkg.delivery_log) ? pkg.delivery_log : [];
    const newLog = [...existingLog, ...deliveryLog];
    const allSent = deliveryLog.every(l => l.status === 'sent' || l.status === 'skipped');

    await adminClient
      .from('license_packages')
      .update({
        delivery_log: newLog,
        delivery_status: allSent ? 'sent' : 'failed',
      })
      .eq('id', package_id);

    // If invoice URL exists, also include in response
    const invoiceUrl = pkg.stripe_invoice_url || null;

    logStep("Delivery complete", { sent: sentCount, total: seats.length });

    return new Response(JSON.stringify({
      sent: sentCount,
      total: seats.length,
      delivery_log: deliveryLog,
      invoice_url: invoiceUrl,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
