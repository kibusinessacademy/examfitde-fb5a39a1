import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

async function invoke(url: string, key: string, fn: string, body: unknown) {
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { fn, ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const steps: Record<string, unknown>[] = [];

  // ── 1. Orphan step reconciliation (safest — auto-enqueue missing jobs) ──
  try {
    const { data, error } = await sb.rpc("fn_reconcile_orphan_steps");
    steps.push({ step: "orphan_reconcile", ok: !error, data: data ?? error?.message });
  } catch (e) {
    steps.push({ step: "orphan_reconcile", ok: false, error: (e as Error).message });
  }

  // ── 2. Ghost completion detection + safe heal ──
  try {
    const { data, error } = await sb.rpc("fn_heal_ghost_completions", { p_mode: "heal_safe" });
    steps.push({ step: "ghost_heal_safe", ok: !error, data: data ?? error?.message });
  } catch (e) {
    steps.push({ step: "ghost_heal_safe", ok: false, error: (e as Error).message });
  }

  // ── 3. Stale admin hold alerts ──
  try {
    const { data, error } = await sb.rpc("fn_alert_stale_admin_holds");
    steps.push({ step: "stale_hold_alert", ok: !error, data: data ?? error?.message });
  } catch (e) {
    steps.push({ step: "stale_hold_alert", ok: false, error: (e as Error).message });
  }

  // ── 4. Stale lock TTL release (DB function) ──
  try {
    // v2: job-type-specific thresholds now handled inside the DB function itself
    const { data, error } = await sb.rpc("fn_release_stale_job_locks", { p_lock_ttl_minutes: 5 });
    steps.push({ step: "stale_lock_ttl", ok: !error, data: data ?? error?.message });
  } catch (e) {
    steps.push({ step: "stale_lock_ttl", ok: false, error: (e as Error).message });
  }

  // ── 5. Orphan reaper (edge function) ──
  steps.push(await invoke(url, key, "system-orphan-reaper", {}));

  // ── 6. Cron governance audit (edge function) ──
  steps.push(await invoke(url, key, "system-cron-governance-audit", {}));

  return json(200, {
    ok: true,
    steps,
    ran_at: new Date().toISOString(),
  });
});
