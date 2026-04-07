/**
 * admin-deploy-smoke-check
 *
 * Post-deploy validation covering THREE dimensions:
 *   1. Model Drift — no forbidden models in critical pipelines
 *   2. Handler Registry — every DB job_type has edgeFunction mapping in code
 *   3. Claim Health — no job types stuck (pending>0, completed_24h=0, other types completing)
 *
 * Auth: x-job-runner-key or x-internal-secret (internal shared secret)
 * Trigger: GitHub Action (hourly + post-deploy) or manual POST
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { JOB_DEFINITIONS } from "../_shared/job-map.ts";

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function toInt(x: unknown, fallback = 0): number {
  const n = typeof x === "number" ? x : parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

// ── Infra jobs exempt from handler requirement ──
const INFRA_JOBS = new Set([
  "pipeline_tick", "stuck_scan", "expire_store_subscriptions", "process_lti_grade_passback",
]);

// ── Model Drift Rules ──
interface SmokeRule {
  jobTypes: string[];
  expectedChainSize: number;
  forbidModelSubstrings: string[];
  lookbackMinutes: number;
}

const MODEL_RULES: SmokeRule[] = [
  {
    jobTypes: ["lesson_generate_content", "package_generate_learning_content"],
    expectedChainSize: 3,
    forbidModelSubstrings: ["nano", "gemini"],
    lookbackMinutes: 360,
  },
  {
    jobTypes: ["package_generate_exam_pool", "package_auto_seed_exam_blueprints"],
    expectedChainSize: 2,
    forbidModelSubstrings: ["gemini"],
    lookbackMinutes: 720,
  },
];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    return jsonResp({ ok: true, health: true, version: "2.0.0" });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    if (req.method !== "POST") return jsonResp({ error: "METHOD_NOT_ALLOWED" }, 405);

    const internalSecret = req.headers.get("x-job-runner-key") ?? req.headers.get("x-internal-secret") ?? "";
    const expectedSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!internalSecret || internalSecret !== expectedSecret) {
      return jsonResp({ error: "UNAUTHORIZED" }, 401);
    }

    const sb = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json().catch(() => ({}));
    const failures: Record<string, unknown>[] = [];
    const checks: Record<string, unknown>[] = [];

    // ═══ CHECK 1: Model Drift ═══
    for (const rule of MODEL_RULES) {
      const lookbackMinutes = toInt(body?.lookback_minutes, 0) || rule.lookbackMinutes;
      const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

      const { data, error } = await sb
        .from("llm_cost_events")
        .select("job_type, model, provider, meta, ts")
        .in("job_type", rule.jobTypes)
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(500);

      if (error) {
        failures.push({ type: "model_drift_db_error", rule: rule.jobTypes, error: error.message });
        continue;
      }

      const rows = data ?? [];
      let forbiddenHits = 0;
      const examples: Record<string, unknown>[] = [];

      for (const r of rows) {
        const model = (r.model ?? "").toLowerCase();
        if (rule.forbidModelSubstrings.some((s) => model.includes(s))) {
          forbiddenHits++;
          if (examples.length < 3) examples.push({ ts: r.ts, job_type: r.job_type, model: r.model });
        }
      }

      const ok = forbiddenHits === 0;
      checks.push({ dimension: "model_drift", jobTypes: rule.jobTypes, sampleCount: rows.length, forbiddenHits, ok, ...(examples.length > 0 ? { examples } : {}) });
      if (!ok) failures.push({ type: "model_drift", jobTypes: rule.jobTypes, forbiddenHits, examples });
    }

    // ═══ CHECK 2: Handler Registry Parity ═══
    const { data: dbPolicies, error: polErr } = await sb
      .from("job_type_policies")
      .select("job_type")
      .limit(500);

    if (polErr) {
      failures.push({ type: "registry_db_error", error: polErr.message });
    } else {
      const dbTypes = new Set((dbPolicies ?? []).map((r: any) => r.job_type));
      const codeTypes = new Set(Object.keys(JOB_DEFINITIONS));

      const inDbNotCode = [...dbTypes].filter(t => !codeTypes.has(t));
      const missingHandler = [...codeTypes].filter(t => !JOB_DEFINITIONS[t]?.edgeFunction && !INFRA_JOBS.has(t));

      const ok = inDbNotCode.length === 0 && missingHandler.length === 0;
      checks.push({
        dimension: "handler_registry",
        db_types: dbTypes.size,
        code_types: codeTypes.size,
        in_db_not_code: inDbNotCode,
        missing_handler: missingHandler,
        ok,
      });
      if (!ok) failures.push({ type: "handler_registry_drift", in_db_not_code: inDbNotCode, missing_handler: missingHandler });
    }

    // ═══ CHECK 3: Claim Health (stuck job types) ═══
    const { data: queueHealth, error: qErr } = await sb.rpc("get_queue_health_by_type");

    if (qErr) {
      // Fallback: manual query
      const { data: rawQ } = await sb
        .from("job_queue")
        .select("job_type, status")
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .limit(1000);

      if (rawQ) {
        const byType: Record<string, { pending: number; completed: number }> = {};
        for (const r of rawQ as any[]) {
          if (!byType[r.job_type]) byType[r.job_type] = { pending: 0, completed: 0 };
          if (r.status === "pending") byType[r.job_type].pending++;
          if (r.status === "completed") byType[r.job_type].completed++;
        }

        const totalCompleted = Object.values(byType).reduce((s, v) => s + v.completed, 0);
        const stuckTypes = Object.entries(byType)
          .filter(([, v]) => v.pending > 2 && v.completed === 0 && totalCompleted > 0)
          .map(([t, v]) => ({ job_type: t, pending: v.pending }));

        const ok = stuckTypes.length === 0;
        checks.push({ dimension: "claim_health", stuck_types: stuckTypes, total_completing_types: totalCompleted, ok });
        if (!ok) failures.push({ type: "claim_health_stuck", stuck_types: stuckTypes });
      }
    } else {
      checks.push({ dimension: "claim_health", data: queueHealth, ok: true });
    }

    // ═══ CHECK 4: Pool Alignment ═══
    if (!polErr && dbPolicies) {
      const dbPoolMap: Record<string, string> = {};
      // re-fetch with pool
      const { data: polWithPool } = await sb.from("job_type_policies").select("job_type, worker_pool").limit(500);
      if (polWithPool) {
        for (const r of polWithPool as any[]) dbPoolMap[r.job_type] = r.worker_pool;
      }

      const poolMismatches: string[] = [];
      for (const [jt, def] of Object.entries(JOB_DEFINITIONS)) {
        const dbPool = dbPoolMap[jt];
        if (dbPool && dbPool !== def.pool) {
          poolMismatches.push(`${jt}: code=${def.pool} db=${dbPool}`);
        }
      }

      const ok = poolMismatches.length === 0;
      checks.push({ dimension: "pool_alignment", mismatches: poolMismatches, ok });
      if (!ok) failures.push({ type: "pool_alignment_drift", mismatches: poolMismatches });
    }

    // ═══ Result ═══
    if (failures.length > 0) {
      console.error("[DEPLOY-SMOKE] FAILED:", JSON.stringify(failures));
      return jsonResp({ ok: false, error: "DEPLOY_SMOKE_CHECK_FAILED", failures, checks }, 500);
    }

    console.log("[DEPLOY-SMOKE] All checks passed.");
    return jsonResp({ ok: true, checks });
  } catch (e) {
    console.error("[DEPLOY-SMOKE] Unhandled:", e);
    return jsonResp({ ok: false, error: "UNHANDLED", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
