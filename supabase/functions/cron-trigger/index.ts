import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient as createSbClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";

/**
 * cron-trigger — Secure proxy for pg_cron → edge functions
 *
 * Supports two scheduling tiers:
 *   - "minute" (default): pipeline-runner, job-runner, pipeline-forensic-test
 *   - "hourly": unified-audit-runner (full system audit with safe autofix)
 *
 * pg_cron calls this with x-cron-secret header + optional body:
 *   { "schedule": "hourly" }       → triggers hourly audit
 *   { "functions": ["foo"] }       → explicit list
 *   (no body / default)            → minute-tier targets
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── Schedule tier definitions ──
const SCHEDULE_TIERS: Record<string, { functions: string[]; bodies: Record<string, string> }> = {
  minute: {
    functions: ["pipeline-runner", "job-runner", "content-runner"],
    bodies: {},
  },
  "5min": {
    functions: [],
    bodies: {},
  },
  hourly: {
    functions: ["unified-audit-runner", "knowledge-graph-rollout-orchestrator"],
    bodies: {
      "unified-audit-runner": JSON.stringify({
        scope: "hourly",
        mode: "safe_autofix",
      }),
      "knowledge-graph-rollout-orchestrator": JSON.stringify({
        scope: "pending",
        max_curricula: 5,
        max_competencies_per_enrichment: 15,
      }),
    },
  },
  nightly: {
    functions: ["knowledge-graph-rollout-orchestrator"],
    bodies: {
      "knowledge-graph-rollout-orchestrator": JSON.stringify({
        scope: "all",
        max_curricula: 50,
        max_competencies_per_enrichment: 25,
      }),
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Schema-Version Handshake
    const sbGate = createSbClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await assertSchemaReady("cron-trigger", sbGate);

    if (!CRON_SECRET) {
      return json({ ok: false, error: "CRON_SECRET not configured" }, 500);
    }

    const provided = req.headers.get("x-cron-secret") ?? "";
    if (provided !== CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    // Parse body — determine schedule tier or explicit function list
    let schedule = "minute";
    let targetFns: string[] | null = null;
    let customBodies: Record<string, string> = {};

    try {
      const body = await req.json();
      if (body?.schedule && SCHEDULE_TIERS[body.schedule]) {
        schedule = body.schedule;
      }
      if (body?.function) targetFns = [String(body.function)];
      if (body?.functions && Array.isArray(body.functions)) targetFns = body.functions.map(String);
    } catch {
      // no body is fine — use default minute tier
    }

    // Resolve targets from tier if not explicitly provided
    const tier = SCHEDULE_TIERS[schedule];
    if (!targetFns) {
      targetFns = tier.functions;
      customBodies = tier.bodies;
    }

    const results: Record<string, unknown>[] = [];

    for (const fn of targetFns) {
      try {
        const fnBody = customBodies[fn] || "{}";
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: SERVICE_ROLE_KEY,
            authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "x-job-runner-key": SERVICE_ROLE_KEY,
          },
          body: fnBody,
        });

        const text = await res.text().catch(() => "");
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        results.push({ function: fn, status: res.status, result: parsed });
      } catch (e: unknown) {
        results.push({ function: fn, error: (e as Error)?.message || String(e) });
      }
    }

    // Log hourly audit runs for observability
    if (schedule === "hourly") {
      try {
        await sbGate.from("system_cron_runs").insert({
          cron_name: "hourly-system-audit",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          result: { schedule, triggered: targetFns, results },
        });
      } catch { /* non-fatal logging */ }
    }

    return json({ ok: true, schedule, triggered: targetFns, results });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
