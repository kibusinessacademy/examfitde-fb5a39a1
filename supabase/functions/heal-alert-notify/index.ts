import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * heal-alert-notify
 *
 * Drains the `heal_alert_notifications` outbox and dispatches each pending
 * row to its configured channel (email via Resend, Slack via incoming webhook).
 *
 * - Service-role only. Cron-invoked via cron-trigger ("heal-alerts" tier).
 * - Missing channel secrets → mark `skipped` (clear last_error reason),
 *   so the user can add the secret later without losing alerts.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-job-runner-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SLACK_HEAL_WEBHOOK_URL = Deno.env.get("SLACK_HEAL_WEBHOOK_URL") ?? "";
const HEAL_ALERT_FROM_EMAIL =
  Deno.env.get("HEAL_ALERT_FROM_EMAIL") ?? "alerts@berufos.com";
const PUBLIC_BASE_URL =
  Deno.env.get("PUBLIC_BASE_URL") ?? "https://berufos.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Row = {
  id: string;
  channel: "email" | "slack";
  target: string;
  alert_key: string;
  severity: string;
  payload: Record<string, unknown>;
  attempts: number;
};

async function dispatchSlack(row: Row): Promise<{ ok: boolean; err?: string }> {
  if (!SLACK_HEAL_WEBHOOK_URL) {
    return { ok: false, err: "SLACK_HEAL_WEBHOOK_URL not configured" };
  }
  const p = row.payload as Record<string, unknown>;
  const link = `${PUBLIC_BASE_URL}${(p.deep_link as string) ?? "/admin/heal-cockpit"}`;
  const text =
    `🛡️ *Heal Alert* — \`${row.alert_key}\` (${row.severity})\n` +
    `${(p.message as string) ?? ""}\n<${link}|Open cockpit>`;
  const res = await fetch(SLACK_HEAL_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.text().catch(() => "");
  return res.ok ? { ok: true } : { ok: false, err: `slack ${res.status}: ${body.slice(0, 200)}` };
}

async function dispatchEmail(row: Row): Promise<{ ok: boolean; err?: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, err: "RESEND_API_KEY not configured" };
  }
  const p = row.payload as Record<string, unknown>;
  const link = `${PUBLIC_BASE_URL}${(p.deep_link as string) ?? "/admin/heal-cockpit"}`;
  const subject = `[ExamFit Heal Alert] ${row.alert_key} (${row.severity})`;
  const html =
    `<h2>Heal Alert</h2>` +
    `<p><strong>${row.alert_key}</strong> — severity: ${row.severity}</p>` +
    `<p>${(p.message as string) ?? ""}</p>` +
    `<p>Value: <code>${p.value ?? "?"}</code> · Threshold: <code>${p.threshold ?? "?"}</code></p>` +
    `<p><a href="${link}">Open Heal Cockpit</a></p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: HEAL_ALERT_FROM_EMAIL,
      to: [row.target],
      subject,
      html,
    }),
  });
  const body = await res.text().catch(() => "");
  return res.ok ? { ok: true } : { ok: false, err: `resend ${res.status}: ${body.slice(0, 200)}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Service-role gate (called via cron-trigger which sets x-job-runner-key)
    const auth = req.headers.get("authorization") ?? "";
    const runnerKey = req.headers.get("x-job-runner-key") ?? "";
    if (
      !auth.includes(SERVICE_ROLE_KEY) &&
      runnerKey !== SERVICE_ROLE_KEY
    ) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const { data: rows, error } = await sb
      .from("heal_alert_notifications")
      .select("id, channel, target, alert_key, severity, payload, attempts")
      .eq("status", "pending")
      .lt("attempts", 5)
      .order("created_at", { ascending: true })
      .limit(25);

    if (error) return json({ ok: false, error: error.message }, 500);

    const results: Array<{ id: string; status: string; err?: string }> = [];

    for (const r of (rows ?? []) as Row[]) {
      const out =
        r.channel === "slack"
          ? await dispatchSlack(r)
          : await dispatchEmail(r);

      const isSkip =
        !out.ok &&
        (out.err?.includes("not configured") ?? false);

      const newStatus = out.ok ? "sent" : isSkip ? "skipped" : "failed";

      await sb
        .from("heal_alert_notifications")
        .update({
          status: newStatus,
          attempts: r.attempts + 1,
          last_error: out.ok ? null : out.err ?? null,
          sent_at: out.ok ? new Date().toISOString() : null,
        })
        .eq("id", r.id);

      results.push({ id: r.id, status: newStatus, err: out.err });
    }

    // Audit summary
    await sb.from("auto_heal_log").insert({
      action_type: "heal_alert_notify_run",
      target_type: "system",
      result_status: "ok",
      result_detail: `dispatched ${results.length} notification(s)`,
      metadata: {
        ts: new Date().toISOString(),
        results,
        slack_configured: Boolean(SLACK_HEAL_WEBHOOK_URL),
        resend_configured: Boolean(RESEND_API_KEY),
      },
    });

    return json({ ok: true, dispatched: results.length, results });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
