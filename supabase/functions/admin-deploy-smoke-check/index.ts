/**
 * admin-deploy-smoke-check
 *
 * Post-deploy validation: queries LIVE llm_cost_events to prove
 * no forbidden models (e.g. Gemini, nano) are running in critical pipelines,
 * and chain_size matches expectations.
 *
 * Auth: x-job-runner-key (internal shared secret)
 * Trigger: GitHub Action (hourly + post-deploy) or manual POST
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

// ── Smoke Rules ──────────────────────────────────────────────
interface SmokeRule {
  jobTypes: string[];
  expectedChainSize: number;
  forbidModelSubstrings: string[];
  lookbackMinutes: number;
}

const RULES: SmokeRule[] = [
  {
    jobTypes: ["lesson_generate_content", "package_generate_learning_content"],
    expectedChainSize: 3,
    forbidModelSubstrings: ["nano", "gemini"],  // v13: Gemini globally banned; nano banned (empty responses)
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
  // Health endpoint
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    return jsonResp({ ok: true, health: true, version: "1.0.0" });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    if (req.method !== "POST") return jsonResp({ error: "METHOD_NOT_ALLOWED" }, 405);

    // Auth: internal shared secret
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
    const lookbackOverrideMin = toInt(body?.lookback_minutes, 0);
    const requireDeployRev = Boolean(body?.require_deploy_rev ?? false);
    const expectedDeployRev = String(body?.expected_deploy_rev ?? "").trim();

    const failures: Record<string, unknown>[] = [];
    const checks: Record<string, unknown>[] = [];

    for (const rule of RULES) {
      const lookbackMinutes = lookbackOverrideMin > 0 ? lookbackOverrideMin : rule.lookbackMinutes;
      const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

      // Query llm_cost_events (SSOT since Feb 2026)
      const { data, error } = await sb
        .from("llm_cost_events")
        .select("job_type, model, provider, meta, ts")
        .in("job_type", rule.jobTypes)
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(500);

      if (error) {
        failures.push({ type: "db_error", rule: rule.jobTypes, error: error.message });
        continue;
      }

      const rows = data ?? [];
      let forbiddenHits = 0;
      let chainSizeMismatches = 0;
      let missingDeployRev = 0;
      let deployRevMismatches = 0;
      const examples: Record<string, unknown>[] = [];

      for (const r of rows) {
        const model = (r.model ?? "").toLowerCase();
        const meta = (r.meta ?? {}) as Record<string, unknown>;
        const chainSize = toInt(meta["chain_size"], -1);
        const deployRev = String(meta["deploy_rev"] ?? "");

        const isForbidden = rule.forbidModelSubstrings.some((s) => model.includes(s));
        if (isForbidden) {
          forbiddenHits++;
          if (examples.length < 5) examples.push({ ts: r.ts, job_type: r.job_type, model: r.model, chain_size: chainSize, deploy_rev: deployRev });
        }

        if (rule.expectedChainSize > 0 && chainSize !== -1 && chainSize !== rule.expectedChainSize) {
          chainSizeMismatches++;
          if (examples.length < 5) examples.push({ ts: r.ts, job_type: r.job_type, model: r.model, chain_size: chainSize, deploy_rev: deployRev });
        }

        if (requireDeployRev) {
          if (!deployRev) missingDeployRev++;
          else if (expectedDeployRev && deployRev !== expectedDeployRev) deployRevMismatches++;
        }
      }

      const ok = forbiddenHits === 0 && chainSizeMismatches === 0 &&
        (!requireDeployRev || (missingDeployRev === 0 && deployRevMismatches === 0));

      const check = {
        jobTypes: rule.jobTypes,
        lookbackMinutes,
        sampleCount: rows.length,
        forbiddenHits,
        chainSizeMismatches,
        ok,
        ...(examples.length > 0 ? { examples } : {}),
      };
      checks.push(check);

      if (!ok) {
        failures.push({ type: "rule_failed", ...check });
      }
    }

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
