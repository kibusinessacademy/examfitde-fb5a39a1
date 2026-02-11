import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "run_error_budget";
    const payload = body.payload ?? {};

    if (action !== "run_error_budget") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
    }

    const run = await sb.from("qa_runs").insert({
      run_type: payload.runType ?? "smoke",
      scope_json: { area: "errors" },
      summary_json: {},
    }).select("id").single();
    if (run.error) throw run.error;
    const runId = run.data.id;

    // Budgets
    const budgets = await sb.from("qa_budgets").select("key, value_num").eq("enabled", true);
    const b = new Map((budgets.data ?? []).map((x: { key: string; value_num: number }) => [x.key, Number(x.value_num)]));

    // Job fail rate
    const job = await sb.rpc("get_job_fail_rate", { p_last_n: 200 });
    if (job.error) throw job.error;
    const jobRow = ((job.data as unknown[]) ?? [])[0] as { fail_rate: number; failed: number; total: number } | undefined;
    const failRate = Number(jobRow?.fail_rate ?? 0);

    const maxFail = b.get("job_fail_rate_max") ?? 0.10;
    if (failRate > maxFail) {
      await upsert(sb, runId, {
        area: "errors", severity: "high",
        title: "Job fail rate exceeded",
        description: `Job fail rate ${(failRate * 100).toFixed(1)}% > ${(maxFail * 100).toFixed(1)}% (last 200 jobs)`,
        evidence: jobRow as unknown as Record<string, unknown>,
      });
    } else {
      await sb.rpc("resolve_qa_finding_if_exists", { p_area: "errors", p_title: "Job fail rate exceeded" });
    }

    // Edge errors (best effort)
    const edge = await sb.rpc("get_edge_error_rate_24h");
    if (edge.error) throw edge.error;

    const edgeData = edge.data as { available: boolean; error_rate?: number } | null;
    if (edgeData?.available) {
      const rate = Number(edgeData.error_rate ?? 0);
      const maxEdge = b.get("edge_error_rate_24h_max") ?? 0.02;
      if (rate > maxEdge) {
        await upsert(sb, runId, {
          area: "errors", severity: "high",
          title: "Edge error rate exceeded (24h)",
          description: `Edge error rate ${(rate * 100).toFixed(2)}% > ${(maxEdge * 100).toFixed(2)}%`,
          evidence: edgeData as unknown as Record<string, unknown>,
        });
      } else {
        await sb.rpc("resolve_qa_finding_if_exists", { p_area: "errors", p_title: "Edge error rate exceeded (24h)" });
      }
    }

    const gate = await sb.rpc("compute_qa_release_gate");
    const summary = { job: jobRow, edge: edgeData, gate: gate.data ?? null };
    await sb.from("qa_runs").update({ summary_json: summary }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, summary }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[qa-council-error-budget] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function upsert(sb: ReturnType<typeof createClient>, runId: string, f: {
  area: string; severity: string; title: string; description: string; evidence?: Record<string, unknown>;
}) {
  const r = await sb.rpc("upsert_qa_finding", {
    p_area: f.area, p_severity: f.severity, p_title: f.title,
    p_description: f.description, p_evidence: f.evidence ?? {}, p_qa_run_id: runId,
  });
  if (r.error) console.error("[qa-error-budget] upsert error:", r.error.message);
}
