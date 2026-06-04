// Track M4 — Owner-Digest Email Renderer + Sender
// Picks pending notification_jobs where kind=org_owner_digest AND channel=email,
// renders an HTML email from payload and sends via Resend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "ExamFit Reports <noreply@berufos.com>";
const BATCH = 25;
const TRACK_BASE = `${SUPABASE_URL}/functions/v1/owner-digest-track`;

function trackUrl(token: string, recipient: string, type: "open" | "click", linkUrl?: string): string {
  const u = new URL(TRACK_BASE);
  u.searchParams.set("t", token);
  u.searchParams.set("r", recipient);
  u.searchParams.set("type", type);
  if (linkUrl) u.searchParams.set("u", linkUrl);
  return u.toString();
}

function injectTracking(html: string, token: string, recipient: string): string {
  if (!token || !recipient) return html;
  // Wrap http(s) hrefs through click-tracker
  const rewritten = html.replace(/href="(https?:\/\/[^"]+)"/g, (_m, link) => {
    return `href="${trackUrl(token, recipient, "click", link)}"`;
  });
  // Append 1x1 open pixel
  const pixel = `<img src="${trackUrl(token, recipient, "open")}" width="1" height="1" alt="" style="display:none" />`;
  if (rewritten.includes("</body>")) {
    return rewritten.replace("</body>", `${pixel}</body>`);
  }
  return rewritten + pixel;
}

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function renderDigestHtml(payload: any, period: string): { subject: string; html: string } {
  const periodLabel = period === "weekly" ? "Wöchentlich" : "Monatlich";
  const orgName = payload?.org_name ?? "deine Organisation";
  const stats = payload?.stats ?? payload ?? {};
  const active = stats.active_licenses ?? 0;
  const total = stats.total_seats ?? 0;
  const used = stats.used_seats ?? 0;
  const utilPct = total > 0 ? Math.round((used / total) * 100) : 0;
  const expiring = stats.expiring_30d ?? 0;
  const learners = stats.active_learners ?? 0;

  const subject = `${periodLabel}er Lizenz-Report — ${orgName}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"/></head><body style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f6f8fa;margin:0;padding:24px;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
    <h1 style="margin:0 0 8px;font-size:20px">${periodLabel}er Lizenz-Report</h1>
    <p style="margin:0 0 24px;color:#475569;font-size:14px">${orgName}</p>

    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b">Aktive Lizenzen</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">${active}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b">Sitzplatz-Auslastung</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">${used} / ${total} (${utilPct}%)</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#64748b">Auslaufend (30 Tage)</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:${expiring > 0 ? '#dc2626' : '#0f172a'}">${expiring}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Aktive Lernende</td><td style="padding:8px 0;text-align:right;font-weight:600">${learners}</td></tr>
    </table>

    ${expiring > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:0 0 24px">
      <strong style="color:#991b1b">${expiring} Lizenz${expiring > 1 ? 'en' : ''} läuft in den nächsten 30 Tagen aus.</strong>
      <p style="margin:8px 0 0;font-size:13px;color:#7f1d1d">Sichere den Lernzugang deiner Mitarbeitenden rechtzeitig durch eine Verlängerung.</p>
    </div>` : ''}

    <a href="https://berufos.com/org/dashboard" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Dashboard öffnen</a>

    <p style="margin:32px 0 0;font-size:12px;color:#94a3b8">Du erhältst diesen Report als Owner/Admin von ${orgName}. <a href="https://berufos.com/app/benachrichtigungen" style="color:#0f766e">Benachrichtigungseinstellungen</a></p>
  </div>
</body></html>`;

  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ status: "skipped", reason: "no_resend_key" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const resend = new Resend(RESEND_KEY);

    // Claim pending email-channel digest jobs
    const { data: jobs, error: jErr } = await supa
      .from("notification_jobs")
      .select("id, user_id, kind, payload")
      .eq("state", "pending")
      .eq("channel", "email")
      .eq("kind", "org_owner_digest")
      .lte("scheduled_for", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(BATCH);

    if (jErr) throw jErr;
    if (!jobs?.length) {
      return new Response(JSON.stringify({ status: "ok", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let sent = 0, failed = 0, skipped_pref = 0;
    for (const job of jobs) {
      try {
        // resolve recipient email
        const { data: userResp } = await supa.auth.admin.getUserById(job.user_id);
        const email = userResp?.user?.email;
        if (!email) {
          await supa.from("notification_jobs").update({
            state: "suppressed", suppression_reason: "no_email", updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          continue;
        }

        const period = (job.payload as any)?.period ?? "weekly";
        const orgIdForPref = (job.payload as any)?.org_id ?? null;

        // M7: Org-Owner Digest Preference Check
        if (orgIdForPref) {
          const { data: pref } = await supa
            .from("org_owner_digest_preferences")
            .select("cadence, enabled")
            .eq("org_id", orgIdForPref)
            .eq("owner_user_id", job.user_id)
            .maybeSingle();
          if (pref && (pref.enabled === false || pref.cadence === "disabled")) {
            await supa.from("notification_jobs").update({
              state: "suppressed",
              suppression_reason: "m7_owner_pref_disabled",
              updated_at: new Date().toISOString(),
            }).eq("id", job.id);
            skipped_pref++;
            continue;
          }
          if (pref && pref.cadence && pref.cadence !== period) {
            await supa.from("notification_jobs").update({
              state: "suppressed",
              suppression_reason: `m7_owner_pref_cadence_mismatch:${pref.cadence}_vs_${period}`,
              updated_at: new Date().toISOString(),
            }).eq("id", job.id);
            skipped_pref++;
            continue;
          }
        }
        const { subject, html: rawHtml } = renderDigestHtml(job.payload, period);

        // Resolve tracking token for this digest (one per org_owner_digests row)
        const digestId = (job.payload as any)?.digest_id ?? null;
        let trackingToken: string | null = (job.payload as any)?.tracking_token ?? null;
        if (!trackingToken && digestId) {
          const { data: digestRow } = await supa
            .from("org_owner_digests")
            .select("tracking_token")
            .eq("id", digestId)
            .maybeSingle();
          trackingToken = (digestRow as any)?.tracking_token ?? null;
        }
        const html = trackingToken
          ? injectTracking(rawHtml, trackingToken, email)
          : rawHtml;

        const res = await resend.emails.send({
          from: FROM, to: [email], subject, html,
          headers: { "X-Job-Id": job.id, "X-Notification-Kind": "org_owner_digest" },
        });

        if ((res as any)?.error) throw new Error(JSON.stringify((res as any).error));

        await supa.from("notification_jobs").update({
          state: "delivered",
          delivered_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          attempts: ((job as any).attempts ?? 0) + 1,
          delivery_result: { provider: "resend", message_id: (res as any)?.data?.id ?? null },
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        // best-effort attribution event
        await supa.from("notification_events").insert({
          job_id: job.id, event_type: "notification_opened",
          metadata: { channel: "email", auto: true, source: "send-org-owner-digest" },
        });

        sent++;
      } catch (err) {
        failed++;
        await supa.from("notification_jobs").update({
          state: "failed",
          last_attempt_at: new Date().toISOString(),
          attempts: ((job as any).attempts ?? 0) + 1,
          delivery_result: { error: String(err) },
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
      }
    }

    return new Response(JSON.stringify({ status: "ok", processed: jobs.length, sent, failed, skipped_pref }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
