// SELLABLE.DISPATCHER.OS.1 — admin_course_auto_heal_queue → job_queue dispatcher
// Auth: CRON_SECRET header OR service_role JWT. Default dry_run=true. Cap=20.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const MAX_ATTEMPTS = 3;
const DEFAULT_CAP = 20;
const SUPPORTED_ACTIONS = new Set(["publish_course_package"]);

interface QueueRow {
  id: string;
  package_id: string;
  curriculum_id: string;
  heal_action: string;
  attempts: number;
  source: string;
  reason_codes: string[] | null;
}

async function logAudit(
  sb: ReturnType<typeof createClient>,
  row: QueueRow,
  status: string,
  detail: string,
  meta: Record<string, unknown>,
  durationMs: number,
  error?: string,
) {
  await sb.from("auto_heal_log").insert({
    trigger_source: "sellable_dispatcher_os1",
    action_type: `dispatcher_${status}`,
    target_id: row.package_id,
    target_type: "course_package",
    input_params: {
      queue_id: row.id,
      curriculum_id: row.curriculum_id,
      heal_action: row.heal_action,
      attempts: row.attempts,
    },
    result_status: status,
    result_detail: detail,
    error_message: error ?? null,
    duration_ms: durationMs,
    metadata: meta,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // --- auth ---
  const hdrSecret = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET.length > 0 && hdrSecret === CRON_SECRET;
  const isService = SERVICE_ROLE.length > 0 && auth.includes(SERVICE_ROLE);

  let isAdmin = false;
  if (!isCron && !isService) {
    try {
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token) {
        const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user) {
          const { data } = await sb.rpc("has_role", { _user_id: user.id, _role: "admin" });
          isAdmin = !!data;
        }
      }
    } catch (_) { /* ignore */ }
  }

  let body: { dry_run?: boolean; cap?: number; heal_action?: string } = {};
  try {
    body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  } catch (_) { /* ignore */ }

  const dryRun = body.dry_run ?? true;
  const cap = Math.min(Math.max(body.cap ?? DEFAULT_CAP, 1), 50);
  const healAction = body.heal_action ?? "publish_course_package";

  // Live writes require admin / service / cron-secret. Dry-run is open for safe smoke calls.
  const authorized = isCron || isService || isAdmin;
  if (!dryRun && !authorized) {
    return new Response(
      JSON.stringify({ error: "unauthorized_for_live_run", hint: "dry_run=true is open; live runs require admin JWT or x-cron-secret" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!SUPPORTED_ACTIONS.has(healAction)) {
    return new Response(
      JSON.stringify({ error: "unsupported_heal_action", heal_action: healAction }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // --- fetch candidates ---
  const { data: candidates, error: fetchErr } = await sb
    .from("admin_course_auto_heal_queue")
    .select("id, package_id, curriculum_id, heal_action, attempts, source, reason_codes")
    .eq("status", "pending")
    .eq("heal_action", healAction)
    .order("created_at", { ascending: true })
    .limit(cap);

  if (fetchErr) {
    return new Response(
      JSON.stringify({ error: "fetch_failed", detail: fetchErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const metrics = {
    dry_run: dryRun,
    cap,
    heal_action: healAction,
    candidates: candidates?.length ?? 0,
    dispatcher_claimed: 0,
    dispatcher_enqueued: 0,
    dispatcher_failed: 0,
    dispatcher_skipped: 0,
    dispatcher_manual_review: 0,
  };
  const actions: Array<Record<string, unknown>> = [];

  for (const row of (candidates ?? []) as QueueRow[]) {
    const itemStart = Date.now();

    // hard guard: manual_review if too many attempts
    if (row.attempts >= MAX_ATTEMPTS) {
      metrics.dispatcher_manual_review++;
      actions.push({ queue_id: row.id, package_id: row.package_id, action: "manual_review", attempts: row.attempts });
      if (!dryRun) {
        await sb.from("admin_course_auto_heal_queue").update({
          status: "manual_review",
          last_error: "attempts_exceeded",
          updated_at: new Date().toISOString(),
        }).eq("id", row.id).eq("status", "pending");
        await logAudit(sb, row, "manual_review", "attempts_exceeded", { max_attempts: MAX_ATTEMPTS }, Date.now() - itemStart);
      }
      continue;
    }

    if (dryRun) {
      metrics.dispatcher_claimed++;
      metrics.dispatcher_enqueued++;
      actions.push({ queue_id: row.id, package_id: row.package_id, action: "would_enqueue" });
      continue;
    }

    // --- claim atomically ---
    const claimToken = crypto.randomUUID();
    const { data: claimed, error: claimErr } = await sb
      .from("admin_course_auto_heal_queue")
      .update({
        status: "processing",
        claim_token: claimToken,
        attempts: row.attempts + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimErr || !claimed) {
      metrics.dispatcher_skipped++;
      actions.push({ queue_id: row.id, action: "skipped_claim_lost", error: claimErr?.message });
      continue;
    }
    metrics.dispatcher_claimed++;

    // --- enqueue publish job ---
    const idempotencyKey = `sellable_dispatcher_os1:${row.package_id}:${row.id}`;
    const { data: job, error: jobErr } = await sb
      .from("job_queue")
      .insert({
        job_type: "package_auto_publish",
        job_name: "package_auto_publish",
        status: "pending",
        priority: 10,
        package_id: row.package_id,
        idempotency_key: idempotencyKey,
        payload: {
          package_id: row.package_id,
          curriculum_id: row.curriculum_id,
          step_key: "auto_publish",
          enqueue_source: "sellable_dispatcher_os1",
          queue_id: row.id,
          reason_codes: row.reason_codes ?? [],
        },
      })
      .select("id")
      .maybeSingle();

    if (jobErr || !job) {
      metrics.dispatcher_failed++;
      await sb.from("admin_course_auto_heal_queue").update({
        status: "pending", // release for retry
        last_error: jobErr?.message ?? "insert_failed",
        updated_at: new Date().toISOString(),
      }).eq("id", row.id).eq("claim_token", claimToken);
      actions.push({ queue_id: row.id, package_id: row.package_id, action: "enqueue_failed", error: jobErr?.message });
      await logAudit(sb, row, "failed", "job_insert_failed", { idempotency_key: idempotencyKey }, Date.now() - itemStart, jobErr?.message);
      continue;
    }

    metrics.dispatcher_enqueued++;
    await sb.from("admin_course_auto_heal_queue").update({
      status: "done",
      last_dispatched_job_id: job.id,
      dispatched_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", row.id).eq("claim_token", claimToken);

    actions.push({ queue_id: row.id, package_id: row.package_id, action: "enqueued", job_id: job.id });
    await logAudit(sb, row, "completed", "job_enqueued", { job_id: job.id, idempotency_key: idempotencyKey }, Date.now() - itemStart);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      took_ms: Date.now() - startedAt,
      metrics,
      actions,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
