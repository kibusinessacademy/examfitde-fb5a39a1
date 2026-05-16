// Post-Purchase Delivery Worker — drains 6 order-keyed delivery jobs.
// Pattern mirrors post-publish-growth-worker but uses payload.order_id.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const MAX_JOBS_PER_RUN = 25;

const HANDLED = [
  "post_purchase_entitlement_create",
  "post_purchase_license_assign",
  "post_purchase_course_access_verify",
  "post_purchase_feature_access_verify",
  "post_purchase_first_lesson_probe",
  "post_purchase_delivery_audit_snapshot",
];

const RPC_MAP: Record<string, string> = {
  post_purchase_entitlement_create: "fn_post_purchase_entitlement_create",
  post_purchase_license_assign: "fn_post_purchase_license_assign",
  post_purchase_course_access_verify: "fn_post_purchase_course_access_verify",
  post_purchase_feature_access_verify: "fn_post_purchase_feature_access_verify",
  post_purchase_first_lesson_probe: "fn_post_purchase_first_lesson_probe",
  post_purchase_delivery_audit_snapshot: "fn_post_purchase_delivery_audit_snapshot",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: cands } = await sb
    .from("job_queue")
    .select("id")
    .in("job_type", HANDLED)
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_JOBS_PER_RUN);

  if (!cands || cands.length === 0) return json({ ok: true, claimed: 0, results: [] });

  const { data: claimed } = await sb
    .from("job_queue")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      locked_at: new Date().toISOString(),
      locked_by: "post-purchase-delivery-worker",
    })
    .in("id", cands.map((c: any) => c.id))
    .eq("status", "pending")
    .select("id, job_type, payload");

  if (!claimed || claimed.length === 0) return json({ ok: true, claimed: 0, results: [] });

  const results: any[] = [];
  for (const job of claimed) {
    const orderId = job.payload?.order_id;
    const rpcName = RPC_MAP[job.job_type];
    let dbStatus = "completed";
    let outcome: any = {};

    if (!orderId) {
      dbStatus = "failed";
      outcome = { ok: false, reason: "missing_order_id_in_payload" };
    } else if (!rpcName) {
      dbStatus = "failed";
      outcome = { ok: false, reason: `unknown_job_type_${job.job_type}` };
    } else {
      try {
        const { data, error } = await sb.rpc(rpcName, { p_order_id: orderId });
        if (error) {
          dbStatus = "failed";
          outcome = { ok: false, reason: error.message };
        } else {
          outcome = data ?? { ok: true };
          if ((outcome as any).ok === false) {
            // Soft-fail: treat as completed (audit-snapshot will pick up reasons)
            dbStatus = "completed";
          }
        }
      } catch (e) {
        dbStatus = "failed";
        outcome = { ok: false, reason: "handler_exception", error: (e as Error).message };
      }
    }

    await sb.from("job_queue").update({
      status: dbStatus,
      completed_at: new Date().toISOString(),
      result: outcome,
      last_error: dbStatus === "failed" ? (outcome.reason ?? "unknown") : null,
    }).eq("id", job.id);

    await sb.from("auto_heal_log").insert({
      action_type: "post_purchase_delivery_worker",
      target_type: "order",
      target_id: orderId ?? null,
      result_status: dbStatus === "completed" ? "success" : "failure",
      result_detail: `${job.job_type}: ${dbStatus}`,
      metadata: { job_id: job.id, job_type: job.job_type, outcome },
    });

    results.push({ job_id: job.id, job_type: job.job_type, status: dbStatus });
  }

  return json({ ok: true, claimed: claimed.length, results });
});
