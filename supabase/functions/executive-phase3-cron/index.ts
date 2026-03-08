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

async function invoke(url: string, key: string, fn: string, body: unknown = {}) {
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const steps: any[] = [];

  // Step 1: Budget guardrails
  steps.push({ step: "budget_eval", ...(await invoke(url, key, "executive-budget-eval")) });

  // Step 2: Portfolio scoring & rebalancing
  steps.push({ step: "portfolio_score", ...(await invoke(url, key, "executive-portfolio-score")) });

  // Step 3: Decision sync (curriculum, wave, channel)
  steps.push({ step: "decision_sync", ...(await invoke(url, key, "executive-decision-sync")) });

  // Step 4: Executive summary report
  steps.push({ step: "summary_report", ...(await invoke(url, key, "executive-summary-report")) });

  return json(200, { ok: true, steps, ran_at: new Date().toISOString() });
});
