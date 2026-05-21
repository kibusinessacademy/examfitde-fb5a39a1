// P0 — AI Eval Worker (2026-05-21)
// Periodic tick: scans active ai_eval_datasets, runs minimal probes
// against the Lovable AI Gateway, records results via fn_record_ai_eval_run.
// Regression windows + audit are updated by the RPC itself.
// Cron: 6h. Heartbeat-mode by default — real per-kind probes wired later.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const PROBE_TIMEOUT_MS = 10_000;

// Per-kind probe definition. For MVP we ping the gateway and score on
// availability + latency. Real semantic eval per kind is the next cut.
async function probeModel(): Promise<{ ok: boolean; latency_ms: number; err?: string }> {
  if (!LOVABLE_API_KEY) return { ok: false, latency_ms: 0, err: "no_api_key" };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 4,
      }),
    });
    clearTimeout(to);
    return { ok: r.ok, latency_ms: Date.now() - t0, err: r.ok ? undefined : `http_${r.status}` };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, err: (e as Error).message };
  }
}

function scoresForKind(kind: string, ok: boolean, latency_ms: number): Array<{ metric: string; value: number; sample_size?: number }> {
  // Availability is the universal heartbeat metric.
  const availability = ok ? 1.0 : 0.0;
  const latency_score = ok ? Math.max(0, 1 - latency_ms / 5000) : 0;
  return [
    { metric: "availability", value: availability, sample_size: 1 },
    { metric: "latency_score", value: Number(latency_score.toFixed(3)), sample_size: 1 },
    { metric: `${kind}_heartbeat`, value: ok ? 1.0 : 0.0, sample_size: 1 },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const t0 = Date.now();

  const { data: datasets, error: dsErr } = await supabase
    .from("ai_eval_datasets")
    .select("id, dataset_key, kind");

  if (dsErr) {
    return new Response(JSON.stringify({ error: dsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let runs_recorded = 0;
  let failures = 0;
  const details: any[] = [];

  // One probe per worker tick — re-use result for all datasets to keep cost flat.
  const probe = await probeModel();

  for (const ds of datasets ?? []) {
    const scores = scoresForKind(ds.kind, probe.ok, probe.latency_ms);
    const { error: recErr } = await supabase.rpc("fn_record_ai_eval_run", {
      p_dataset_key: ds.dataset_key,
      p_model: DEFAULT_MODEL,
      p_job_type: "ai_eval_worker_tick",
      p_scores: scores,
      p_status: probe.ok ? "succeeded" : "failed",
      p_notes: probe.err ?? null,
    });
    if (recErr) {
      failures++;
      details.push({ dataset_key: ds.dataset_key, error: recErr.message });
    } else {
      runs_recorded++;
    }
  }

  await supabase.rpc("fn_emit_audit", {
    _action_type: "ai_eval_worker_run",
    _payload: {
      datasets_scanned: datasets?.length ?? 0,
      runs_recorded,
      failures,
      duration_ms: Date.now() - t0,
      probe_ok: probe.ok,
      probe_latency_ms: probe.latency_ms,
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      datasets_scanned: datasets?.length ?? 0,
      runs_recorded,
      failures,
      probe,
      details: details.slice(0, 5),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
