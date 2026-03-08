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

  // Step 1: ROI per curriculum
  steps.push({ step: "roi_sync", ...(await invoke(url, key, "control-plane-roi-sync")) });

  // Step 2: Channel unit economics
  steps.push({ step: "unit_economics", ...(await invoke(url, key, "control-plane-unit-economics")) });

  // Step 3: Wave governance
  steps.push({ step: "wave_governance", ...(await invoke(url, key, "control-plane-wave-governance")) });

  // Step 4: Business KPI snapshot
  steps.push({ step: "business_snapshot", ...(await invoke(url, key, "control-plane-business-snapshot")) });

  return json(200, { ok: true, steps, ran_at: new Date().toISOString() });
});
