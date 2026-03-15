/**
 * knowledge-graph-rollout-orchestrator — Automated KG lifecycle loop.
 *
 * For each curriculum:
 *   1. Build SSOT graph (nodes/edges from competencies, blueprints, etc.)
 *   2. Enrich error patterns via AI (for competencies with low coverage)
 *   3. Evaluate KG readiness (≥20 comps, ≥60% with ≥2 error patterns)
 *   4. Auto-set/remove kg_rollout_curriculum_<id> config flag
 *   5. Log result for ops transparency
 *
 * POST body (all optional):
 *   {
 *     "scope": "all" | "pending",     // "pending" = only curricula without ready flag
 *     "max_curricula": 20,
 *     "max_competencies_per_enrichment": 25,
 *     "min_errors": 3,
 *     "dry_run": false
 *   }
 *
 * Security: Accepts service-role or x-job-runner-key (cron-trigger).
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Readiness thresholds (SSOT — change here, not in caller) ──
const READINESS = {
  MIN_COMPETENCIES: 20,
  MIN_COVERAGE_PCT: 0.60,
  MIN_ERRORS_PER_COMP: 2,
} as const;

interface CurriculumResult {
  curriculum_id: string;
  title: string;
  ssot_build: { ok: boolean; error?: string };
  enrichment: { ok: boolean; nodes_created?: number; error?: string };
  readiness: {
    competencies_total: number;
    competencies_ready: number;
    pct_ready: number;
    is_ready: boolean;
  };
  flag_action: "set_true" | "set_false" | "unchanged" | "dry_run";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startMs = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Parse options
    const body = await req.json().catch(() => ({} as any));
    const scope: string = body.scope ?? "all";
    const maxCurricula: number = body.max_curricula ?? 20;
    const maxCompsPerEnrich: number = body.max_competencies_per_enrichment ?? 25;
    const minErrors: number = body.min_errors ?? 3;
    const dryRun: boolean = body.dry_run === true;

    console.log(`[kg-orchestrator] scope=${scope} max=${maxCurricula} dry=${dryRun}`);

    // 1. Load curricula
    const curricula = await loadCurricula(sb, scope, maxCurricula);
    console.log(`[kg-orchestrator] ${curricula.length} curricula selected`);

    if (!curricula.length) {
      return json({ ok: true, message: "No curricula to process", results: [] });
    }

    // 2. Process each curriculum
    const results: CurriculumResult[] = [];

    for (const curr of curricula) {
      const result = await processCurriculum(
        sb, SUPABASE_URL, SERVICE_ROLE_KEY,
        curr, maxCompsPerEnrich, minErrors, dryRun,
      );
      results.push(result);
      console.log(
        `[kg-orchestrator] ${curr.title}: ready=${result.readiness.is_ready} ` +
        `(${result.readiness.pct_ready.toFixed(1)}%) flag=${result.flag_action}`,
      );
    }

    const elapsed = Date.now() - startMs;
    const summary = {
      ok: true,
      elapsed_ms: elapsed,
      scope,
      dry_run: dryRun,
      total_processed: results.length,
      newly_ready: results.filter(r => r.flag_action === "set_true").length,
      newly_unready: results.filter(r => r.flag_action === "set_false").length,
      unchanged: results.filter(r => r.flag_action === "unchanged").length,
      results,
    };

    // 3. Log to ops audit
    try {
      await sb.from("auto_heal_log").insert({
        action_type: "kg_rollout_orchestrator",
        trigger_source: dryRun ? "manual_dry_run" : "orchestrator",
        target_type: "knowledge_graph",
        result_status: "success",
        result_detail: `${results.length} curricula, ${summary.newly_ready} newly ready`,
        duration_ms: elapsed,
        metadata: {
          scope,
          newly_ready: summary.newly_ready,
          newly_unready: summary.newly_unready,
          unchanged: summary.unchanged,
        },
      });
    } catch { /* non-fatal */ }

    return json(summary);
  } catch (e) {
    console.error("[kg-orchestrator] fatal:", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

// ── Load curricula based on scope ──

async function loadCurricula(
  sb: any, scope: string, max: number,
): Promise<Array<{ id: string; title: string }>> {
  if (scope === "pending") {
    // Only curricula WITHOUT an existing ready-flag
    const { data: allCurr } = await sb
      .from("curricula")
      .select("id, title")
      .order("title")
      .limit(200);

    if (!allCurr?.length) return [];

    const { data: flags } = await sb
      .from("ops_pipeline_config")
      .select("key, value")
      .like("key", "kg_rollout_curriculum_%");

    const readyIds = new Set<string>();
    for (const f of flags || []) {
      const val = String(f.value ?? "").replace(/^"|"$/g, "");
      if (val === "true") {
        readyIds.add(f.key.replace("kg_rollout_curriculum_", ""));
      }
    }

    return allCurr
      .filter((c: any) => !readyIds.has(c.id))
      .slice(0, max);
  }

  // scope = "all"
  const { data } = await sb
    .from("curricula")
    .select("id, title")
    .order("title")
    .limit(max);

  return data || [];
}

// ── Process single curriculum ──

async function processCurriculum(
  sb: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  curr: { id: string; title: string },
  maxCompsPerEnrich: number,
  minErrors: number,
  dryRun: boolean,
): Promise<CurriculumResult> {
  const result: CurriculumResult = {
    curriculum_id: curr.id,
    title: curr.title,
    ssot_build: { ok: false },
    enrichment: { ok: false },
    readiness: { competencies_total: 0, competencies_ready: 0, pct_ready: 0, is_ready: false },
    flag_action: dryRun ? "dry_run" : "unchanged",
  };

  // Step 1: SSOT Build
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/knowledge-graph-build-ssot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ curriculum_id: curr.id }),
    });
    const data = await res.json().catch(() => ({}));
    result.ssot_build = { ok: res.ok, ...(res.ok ? {} : { error: data?.error || `HTTP ${res.status}` }) };
  } catch (e) {
    result.ssot_build = { ok: false, error: (e as Error).message };
  }

  // Step 2: Error Enrichment
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/knowledge-graph-enrich-errors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        curriculum_id: curr.id,
        max_competencies: maxCompsPerEnrich,
        min_errors: minErrors,
      }),
    });
    const data = await res.json().catch(() => ({}));
    result.enrichment = {
      ok: res.ok,
      nodes_created: data?.nodes_created ?? 0,
      ...(res.ok ? {} : { error: data?.error || `HTTP ${res.status}` }),
    };
  } catch (e) {
    result.enrichment = { ok: false, error: (e as Error).message };
  }

  // Step 3: Evaluate readiness (direct SQL query)
  try {
    const readiness = await evaluateReadiness(sb, curr.id);
    result.readiness = readiness;
  } catch (e) {
    console.error(`[kg-orchestrator] readiness eval error for ${curr.id}: ${(e as Error).message}`);
  }

  // Step 4: Auto-flag update
  if (!dryRun) {
    const flagKey = `kg_rollout_curriculum_${curr.id}`;
    const { data: existing } = await sb
      .from("ops_pipeline_config")
      .select("value")
      .eq("key", flagKey)
      .maybeSingle();

    const currentlyReady = String(existing?.value ?? "").replace(/^"|"$/g, "") === "true";

    if (result.readiness.is_ready && !currentlyReady) {
      await sb.from("ops_pipeline_config").upsert(
        { key: flagKey, value: "true" },
        { onConflict: "key" },
      );
      result.flag_action = "set_true";
    } else if (!result.readiness.is_ready && currentlyReady) {
      await sb.from("ops_pipeline_config").upsert(
        { key: flagKey, value: "false" },
        { onConflict: "key" },
      );
      result.flag_action = "set_false";
    } else {
      result.flag_action = "unchanged";
    }
  }

  return result;
}

// ── Readiness evaluation ──

async function evaluateReadiness(
  sb: any,
  curriculumId: string,
): Promise<{ competencies_total: number; competencies_ready: number; pct_ready: number; is_ready: boolean }> {
  // Get learning fields for this curriculum
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId);

  if (!lfs?.length) {
    return { competencies_total: 0, competencies_ready: 0, pct_ready: 0, is_ready: false };
  }

  // Get competencies
  const { data: comps } = await sb
    .from("competencies")
    .select("id")
    .in("learning_field_id", lfs.map((l: any) => l.id));

  const total = comps?.length ?? 0;
  if (total < READINESS.MIN_COMPETENCIES) {
    return { competencies_total: total, competencies_ready: 0, pct_ready: 0, is_ready: false };
  }

  // Get competency nodes
  const compIds = comps!.map((c: any) => c.id);
  const { data: compNodes } = await sb
    .from("knowledge_graph_nodes")
    .select("id, source_id")
    .eq("node_type", "competency")
    .eq("is_active", true)
    .in("source_id", compIds);

  if (!compNodes?.length) {
    return { competencies_total: total, competencies_ready: 0, pct_ready: 0, is_ready: false };
  }

  // Count error_pattern edges per competency node
  const nodeIds = compNodes.map((n: any) => n.id);
  const { data: edges } = await sb
    .from("knowledge_graph_edges")
    .select("to_node_id")
    .eq("edge_type", "causes_error")
    .eq("is_active", true)
    .in("to_node_id", nodeIds);

  const countMap = new Map<string, number>();
  for (const e of edges || []) {
    countMap.set(e.to_node_id, (countMap.get(e.to_node_id) || 0) + 1);
  }

  const ready = compNodes.filter(
    (n: any) => (countMap.get(n.id) || 0) >= READINESS.MIN_ERRORS_PER_COMP,
  ).length;

  const pct = ready / total;

  return {
    competencies_total: total,
    competencies_ready: ready,
    pct_ready: Math.round(pct * 1000) / 10,
    is_ready: pct >= READINESS.MIN_COVERAGE_PCT,
  };
}
