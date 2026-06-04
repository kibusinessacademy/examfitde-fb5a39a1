import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

function buildPublication(args: {
  targetType: string;
  channelKey: string;
  title?: string;
  slug?: string;
  payload?: any;
}) {
  return {
    published_title: args.title || "Untitled Asset",
    published_slug: args.slug || "untitled-asset",
    publication_payload: {
      target_type: args.targetType,
      channel_key: args.channelKey,
      payload: args.payload || {},
    },
  };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const workerId = body.worker_id || "distribution-worker";
  const limit = Math.min(Number(body.limit ?? 10), 25);

  const { data: run } = await sb
    .from("distribution_runs")
    .insert({ run_type: "worker", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  const { data: jobs, error: claimErr } = await sb.rpc("claim_distribution_jobs", {
    p_limit: limit,
    p_worker_id: workerId,
    p_lease_minutes: 10,
  });

  if (claimErr) {
    if (runId) await sb.from("distribution_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: claimErr.message } }).eq("id", runId);
    return json(500, { error: claimErr.message }, origin);
  }

  const results: any[] = [];
  let doneCount = 0;
  let errorCount = 0;

  for (const job of jobs || []) {
    try {
      const { data: target } = await sb
        .from("distribution_targets")
        .select("*")
        .eq("id", job.target_id)
        .single();

      const { data: asset } = await sb
        .from("campaign_assets")
        .select("*")
        .eq("id", job.asset_id)
        .single();

      const publication = buildPublication({
        targetType: target?.target_type,
        channelKey: job.channel_key,
        title: asset?.title,
        slug: asset?.slug,
        payload: job.payload,
      });

      const { data: pubRow, error: pubErr } = await sb
        .from("distribution_publications")
        .insert({
          target_id: job.target_id,
          queue_id: job.id,
          asset_id: job.asset_id,
          channel_key: job.channel_key,
          publication_status: "published",
          external_ref: crypto.randomUUID(),
          external_url: `https://berufos.com/${job.channel_key}/${asset?.slug || "draft"}`,
          published_title: publication.published_title,
          published_slug: publication.published_slug,
          publication_payload: publication.publication_payload,
          published_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (pubErr) throw pubErr;

      await sb.from("distribution_queue").update({
        status: "done",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result_meta: { publication_id: pubRow.id },
      }).eq("id", job.id);

      await sb.from("distribution_targets").update({
        distribution_status: "published",
        updated_at: new Date().toISOString(),
      }).eq("id", job.target_id);

      await sb.from("distribution_delivery_logs").insert({
        publication_id: pubRow.id,
        queue_id: job.id,
        target_id: job.target_id,
        channel_key: job.channel_key,
        event_type: "publish",
        status: "ok",
        message: "Publication created",
        payload: { publication_id: pubRow.id },
      });

      doneCount++;
      results.push({ queue_id: job.id, publication_id: pubRow.id, status: "done" });
    } catch (e: any) {
      errorCount++;
      const isDead = (job.attempts || 0) >= (job.max_attempts || 5);

      await sb.from("distribution_queue").update({
        status: isDead ? "dead" : "failed",
        last_error: e.message,
        updated_at: new Date().toISOString(),
        ...(isDead ? { finished_at: new Date().toISOString() } : {
          run_after: new Date(Date.now() + 60_000 * Math.pow(2, job.attempts || 1)).toISOString(),
        }),
      }).eq("id", job.id);

      await sb.from("distribution_delivery_logs").insert({
        queue_id: job.id,
        target_id: job.target_id,
        channel_key: job.channel_key,
        event_type: "publish",
        status: "error",
        message: e.message,
        payload: {},
      });

      results.push({ queue_id: job.id, status: isDead ? "dead" : "retry", error: e.message });
    }
  }

  if (runId) {
    await sb.from("distribution_runs").update({
      status: "done",
      processed_count: (jobs || []).length,
      delivered_count: doneCount,
      error_count: errorCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, claimed: (jobs || []).length, delivered: doneCount, errors: errorCount, results }, origin);
});
