import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRunnerHealth } from "../_shared/runner-health.ts";

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
  const sb = createClient(url, key);

  const steps: any[] = [];

  // Step 0: Runner Health Check — FIRST LINE OF DEFENSE
  try {
    const health = await checkRunnerHealth(sb);
    if (health.alerts.length > 0) {
      for (const alert of health.alerts) {
        console.error(`[control-plane] ${alert}`);
      }
      // Write alerts to admin_notifications for visibility
      for (const alert of health.alerts) {
        const severity = alert.includes("🔴") ? "critical" : "warning";
        await sb.from("admin_notifications").insert({
          title: alert.slice(0, 200),
          category: "runner_health",
          severity,
          entity_type: "runner",
          metadata: { runners: health.runners, dead_lanes: health.dead_lanes },
        }).then(() => {});
      }
    }
    steps.push({ step: "runner_health", ok: true, data: health });
  } catch (e) {
    steps.push({ step: "runner_health", ok: false, error: (e as Error).message });
  }

  // Step 1: Build system snapshot
  steps.push({ step: "snapshot", ...(await invoke(url, key, "control-plane-snapshot")) });

  // Step 2: Evaluate policies against current state
  steps.push({ step: "policy_eval", ...(await invoke(url, key, "control-plane-policy-eval")) });

  // Step 3: Execute queued actions
  steps.push({ step: "action_executor", ...(await invoke(url, key, "control-plane-action-executor")) });

  // Step 4: Phase 2 — ROI, Unit Economics, Wave Governance, Business Snapshot
  steps.push({ step: "phase2", ...(await invoke(url, key, "control-plane-phase2-cron")) });

  // Step 5: Phase 3 — Executive Autonomy, Budget Guardrails, Portfolio Steering
  steps.push({ step: "phase3", ...(await invoke(url, key, "executive-phase3-cron")) });

  return json(200, {
    ok: true,
    steps,
    ran_at: new Date().toISOString(),
  });
});