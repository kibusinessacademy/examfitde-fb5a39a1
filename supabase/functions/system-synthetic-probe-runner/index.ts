import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ProbeRow = {
  probe_key: string;
  probe_scope: string;
  probe_type: string;
  severity: "info" | "warn" | "critical";
  config: any;
  expected_result: any;
};

async function countTable(sb: any, table: string): Promise<number> {
  const { count } = await sb.from(table).select("id", { head: true, count: "exact" });
  return Number(count || 0);
}

async function openProbeAlert(sb: any, probe: ProbeRow, title: string, message: string, payload: any) {
  await sb.from("system_probe_alerts").insert({
    probe_key: probe.probe_key,
    severity: probe.severity,
    status: "open",
    title,
    message,
    payload,
  });
}

async function runProbe(sb: any, probe: ProbeRow, serviceKey: string, url: string) {
  const started = Date.now();

  try {
    if (probe.probe_type === "rpc") {
      if (probe.config?.rpc === "run_system_contract_audit") {
        const { data, error } = await sb.rpc("run_system_contract_audit");
        if (error) throw new Error(error.message);
        const ok = data?.ok === true;
        return {
          status: ok ? "pass" : "fail",
          latency_ms: Date.now() - started,
          message: ok ? "Contract audit ok" : "Contract audit failed",
          result: data,
        };
      }

      if (probe.config?.rpc === "assert_pipeline_status_integrity") {
        const { data, error } = await sb.rpc("assert_pipeline_status_integrity");
        if (error) throw new Error(error.message);
        const ok = data?.ok === true;
        return {
          status: ok ? "pass" : "fail",
          latency_ms: Date.now() - started,
          message: ok ? "Pipeline status integrity ok" : "Pipeline status invalid",
          result: data,
        };
      }

      if (probe.config?.assertion === "curriculum_gtm_scores_exist") {
        const { count } = await sb.from("curriculum_gtm_scores").select("id", { head: true, count: "exact" });
        const ok = Number(count || 0) >= Number(probe.expected_result?.min_rows || 1);
        return {
          status: ok ? "pass" : "warn",
          latency_ms: Date.now() - started,
          message: `curriculum_gtm_scores count=${count}`,
          result: { count },
        };
      }
    }

    if (probe.probe_type === "db_assertion") {
      const table = probe.config?.table;
      const cnt = await countTable(sb, table);
      const ok = cnt >= Number(probe.expected_result?.min_rows || 1);
      return {
        status: ok ? "pass" : "warn",
        latency_ms: Date.now() - started,
        message: `${table} count=${cnt}`,
        result: { table, count: cnt },
      };
    }

    if (probe.probe_type === "edge_function") {
      const fn = probe.config?.edge_function;
      const body = probe.config?.body || {};

      const res = await fetch(`${url}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);
      const ok = res.ok && (data?.ok === true || data?.snapshot_id || data?.steps || data?.report_id);

      return {
        status: ok ? "pass" : "fail",
        latency_ms: Date.now() - started,
        message: `${fn} status=${res.status}`,
        result: data || {},
      };
    }

    if (probe.probe_type === "synthetic_chain") {
      const checks = probe.config?.checks || [];

      const contractAudit = checks.includes("contracts")
        ? await sb.rpc("run_system_contract_audit")
        : { data: { ok: true } };

      const campaignAssets = checks.includes("campaign_assets")
        ? await countTable(sb, "campaign_assets")
        : 1;

      const distributionPublications = checks.includes("distribution_publications")
        ? await countTable(sb, "distribution_publications")
        : 1;

      const optimizationScores = checks.includes("optimization_scores")
        ? await countTable(sb, "asset_optimization_scores")
        : 1;

      const ok =
        contractAudit.data?.ok === true &&
        campaignAssets > 0 &&
        distributionPublications > 0 &&
        optimizationScores > 0;

      return {
        status: ok ? "pass" : "fail",
        latency_ms: Date.now() - started,
        message: ok ? "Golden path ok" : "Golden path broken",
        result: {
          contract_audit: contractAudit.data,
          campaign_assets: campaignAssets,
          distribution_publications: distributionPublications,
          optimization_scores: optimizationScores,
        },
      };
    }

    return {
      status: "warn" as const,
      latency_ms: Date.now() - started,
      message: `Unhandled probe type ${probe.probe_type}`,
      result: {},
    };
  } catch (e) {
    return {
      status: probe.severity === "critical" ? "fail" : "warn",
      latency_ms: Date.now() - started,
      message: (e as Error).message,
      result: { error: (e as Error).message },
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const url = Deno.env.get("SUPABASE_URL")!;

  const body = await req.json().catch(() => ({}));
  const runType = body.run_type || "manual";

  const { data: probes, error } = await sb
    .from("system_probe_definitions")
    .select("*")
    .eq("is_enabled", true)
    .order("probe_scope");

  if (error) return json(500, { error: error.message });

  const { data: runRow, error: runErr } = await sb
    .from("system_probe_runs")
    .insert({
      run_type: runType,
      status: "running",
      total_probes: (probes || []).length,
    })
    .select("id")
    .single();

  if (runErr) return json(500, { error: runErr.message });

  let passed = 0;
  let warned = 0;
  let failed = 0;
  let criticalFailed = 0;

  const results: any[] = [];

  for (const probe of (probes || []) as ProbeRow[]) {
    const result = await runProbe(sb, probe, serviceKey, url);

    if (result.status === "pass") passed++;
    if (result.status === "warn") warned++;
    if (result.status === "fail") failed++;
    if (result.status === "fail" && probe.severity === "critical") criticalFailed++;

    await sb.from("system_probe_results").insert({
      probe_run_id: runRow.id,
      probe_key: probe.probe_key,
      probe_scope: probe.probe_scope,
      status: result.status,
      severity: probe.severity,
      latency_ms: result.latency_ms,
      message: result.message,
      result: result.result,
    });

    if (result.status !== "pass") {
      await openProbeAlert(sb, probe, `Probe ${probe.probe_key} ${result.status}`, result.message, result.result);
    }

    results.push({
      probe_key: probe.probe_key,
      scope: probe.probe_scope,
      status: result.status,
      latency_ms: result.latency_ms,
      message: result.message,
    });
  }

  const finalStatus = failed > 0 ? "failed" : "done";

  await sb.from("system_probe_runs").update({
    status: finalStatus,
    passed_count: passed,
    warned_count: warned,
    failed_count: failed,
    critical_failed_count: criticalFailed,
    summary: { passed, warned, failed, critical_failed: criticalFailed },
    finished_at: new Date().toISOString(),
  }).eq("id", runRow.id);

  return json(200, {
    ok: failed === 0,
    probe_run_id: runRow.id,
    status: finalStatus,
    passed_count: passed,
    warned_count: warned,
    failed_count: failed,
    critical_failed_count: criticalFailed,
    results,
  });
});
