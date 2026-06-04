// supabase/functions/send-learner-push/index.ts
// Track 5 Phase 2 — Notification Dispatcher (Web Push).
// Claims pending notification_jobs and sends via VAPID web-push.
// Missing VAPID env → returns skipped:no_vapid (kein Datenverlust).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// @ts-ignore deno npm specifier
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@berufos.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(
      JSON.stringify({ status: "skipped", reason: "no_vapid" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const limit = 20;

  const { data: jobs, error: claimErr } = await sb.rpc("admin_notification_claim_batch", {
    p_limit: limit,
  });
  if (claimErr) {
    return new Response(JSON.stringify({ error: claimErr.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
  if (!jobs?.length) {
    return new Response(JSON.stringify({ status: "noop", claimed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }

  let delivered = 0;
  let failed = 0;
  let no_subs = 0;
  let suppressed = 0;
  let delayed = 0;

  for (const job of jobs) {
    // Track 2.5 — enforce adaptive policy at dispatch time
    const { data: enforcement } = await sb.rpc("fn_enforce_notification_policy", { p_job_id: job.id });
    const action = (enforcement as any)?.action ?? "allowed";
    if (action === "suppressed") { suppressed += 1; continue; }
    if (action === "delayed") { delayed += 1; continue; }

    const { data: subs } = await sb
      .from("learner_push_subscriptions")
      .select("id,endpoint,p256dh,auth_key")
      .eq("user_id", job.user_id)
      .is("revoked_at", null);

    if (!subs?.length) {
      await sb.rpc("fn_record_notification_delivery", {
        p_job_id: job.id,
        p_status: "failed",
        p_error: "no_subscriptions",
        p_result: {},
      });
      no_subs += 1;
      continue;
    }

    const payload = JSON.stringify({
      title: job.payload?.title ?? "ExamFit",
      body: job.payload?.body ?? "Neue Empfehlung verfügbar.",
      deeplink: job.payload?.deeplink ?? "/dashboard",
      kind: job.kind,
      job_id: job.id,
    });

    const results: Array<{ endpoint: string; ok: boolean; code?: number; err?: string }> = [];
    let any_ok = false;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
          payload,
        );
        results.push({ endpoint: s.endpoint, ok: true });
        any_ok = true;
      } catch (e: any) {
        const code = e?.statusCode;
        results.push({ endpoint: s.endpoint, ok: false, code, err: String(e?.body ?? e?.message ?? e) });
        if (code === 404 || code === 410) {
          await sb
            .from("learner_push_subscriptions")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", s.id);
        }
      }
    }

    if (any_ok) {
      delivered += 1;
      await sb.rpc("fn_record_notification_delivery", {
        p_job_id: job.id,
        p_status: "delivered",
        p_error: null,
        p_result: { results },
      });
    } else {
      failed += 1;
      await sb.rpc("fn_record_notification_delivery", {
        p_job_id: job.id,
        p_status: "failed",
        p_error: "all_endpoints_failed",
        p_result: { results },
      });
    }
  }

  return new Response(
    JSON.stringify({ status: "ok", claimed: jobs.length, delivered, failed, no_subs, suppressed, delayed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
