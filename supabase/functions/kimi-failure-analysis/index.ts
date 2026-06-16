/**
 * KIMI Failure Intelligence
 * Analyzes recent pipeline failures across job_queue, pipeline_alerts, auto_heal_log.
 * Produces clustered root-cause findings and repair recommendations.
 * READ-ONLY.
 */
import {
  corsHeaders, getServiceClient, startSnapshot, finishSnapshot,
  persistFindings, callKimi, RESPONSE_SCHEMA_INSTRUCTIONS,
} from "../_shared/kimi-qil.ts";

const SYSTEM_PROMPT = `Du bist KIMI — der Quality Intelligence Auditor für die ExamFit Course-Production-Pipeline.
Du erhältst eine Stichprobe von Pipeline-Failures der letzten 7 Tage (job_queue Fails, pipeline_alerts, auto_heal_log Einträge mit error_message).
Deine Aufgabe: Cluster bilden, Root Causes identifizieren, Reparaturvorschläge priorisieren.

Du darfst NIE selbst etwas reparieren, approven, publishen oder scoren — nur analysieren und empfehlen.

${RESPONSE_SCHEMA_INSTRUCTIONS}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = getServiceClient();
  const t0 = Date.now();
  let snapshotId: string | null = null;

  try {
    // Pull last 7d failure signals (sampled / capped)
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();

    const [failedJobs, alerts, healFails] = await Promise.all([
      sb.from("job_queue")
        .select("id, job_name, status, last_error, retry_count, created_at, payload")
        .in("status", ["failed", "dead"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300),
      sb.from("pipeline_alerts")
        .select("id, alert_type, severity, message, package_id, created_at, metadata")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
      sb.from("auto_heal_log")
        .select("id, action_type, result_status, error_message, target_type, target_id, created_at")
        .in("result_status", ["failed", "error"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const inputSummary = {
      window_days: 7,
      failed_jobs: failedJobs.data?.length ?? 0,
      pipeline_alerts: alerts.data?.length ?? 0,
      auto_heal_failures: healFails.data?.length ?? 0,
    };

    snapshotId = await startSnapshot(sb, "failure", inputSummary);

    const totalSignals = (failedJobs.data?.length ?? 0)
      + (alerts.data?.length ?? 0)
      + (healFails.data?.length ?? 0);

    if (totalSignals === 0) {
      await finishSnapshot(sb, snapshotId, {
        status: "succeeded",
        finding_count: 0,
        recommendation_count: 0,
        duration_ms: Date.now() - t0,
        output_summary: { message: "no failure signals in window" },
      });
      return new Response(JSON.stringify({ ok: true, snapshot_id: snapshotId, findings: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { result, tokens_input, tokens_output } = await callKimi(SYSTEM_PROMPT, {
      failed_jobs: failedJobs.data ?? [],
      pipeline_alerts: alerts.data ?? [],
      auto_heal_failures: healFails.data ?? [],
    });

    const { recCount } = await persistFindings(sb, snapshotId, "failure", result.findings);

    await finishSnapshot(sb, snapshotId, {
      status: "succeeded",
      finding_count: result.findings.length,
      recommendation_count: recCount,
      tokens_input, tokens_output,
      duration_ms: Date.now() - t0,
      output_summary: { summary: result.summary },
    });

    return new Response(JSON.stringify({
      ok: true, snapshot_id: snapshotId,
      findings: result.findings.length, recommendations: recCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (snapshotId) {
      await finishSnapshot(sb, snapshotId, {
        status: "failed", error_message: msg, duration_ms: Date.now() - t0,
      });
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
