import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  PIPELINE_GRAPH,
  FULL_STEP_ORDER,
  ARTIFACT_IMPACT,
  type PipelineNode,
} from "../_shared/job-map.ts";
import { checkArtifacts } from "../_shared/artifact-resolver.ts";

/**
 * Pipeline Simulator (Phase 7)
 * 
 * Read-only analysis of a package's pipeline state.
 * Returns: ETA estimate, critical path, missing artifacts, deadlock risk.
 * 
 * POST { package_id: string }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { package_id } = await req.json().catch(() => ({}));
  if (!package_id) return json({ ok: false, error: "package_id required" }, 400);

  // 1. Load all package_steps
  const { data: steps } = await sb
    .from("package_steps")
    .select("step_key, status, updated_at, meta")
    .eq("package_id", package_id);

  if (!steps?.length) return json({ ok: false, error: "No steps found for package" }, 404);

  const stepMap = new Map(steps.map(s => [s.step_key, s]));

  // 2. Load avg durations from step_metrics
  const { data: metrics } = await sb
    .from("step_metrics")
    .select("step_key, duration_ms")
    .order("created_at", { ascending: false })
    .limit(500);

  const avgDurations = new Map<string, number>();
  const durationBuckets = new Map<string, number[]>();
  for (const m of metrics ?? []) {
    if (!durationBuckets.has(m.step_key)) durationBuckets.set(m.step_key, []);
    durationBuckets.get(m.step_key)!.push(m.duration_ms);
  }
  for (const [key, durations] of durationBuckets) {
    avgDurations.set(key, Math.round(durations.reduce((a, b) => a + b, 0) / durations.length));
  }

  // Default durations (ms) for steps without metrics
  const DEFAULT_DURATION_MS = 60_000;

  // 3. Classify steps
  const done: string[] = [];
  const blocked: string[] = [];
  const failed: string[] = [];
  const pending: string[] = [];
  const notStarted: string[] = [];

  for (const node of PIPELINE_GRAPH) {
    const step = stepMap.get(node.key);
    if (!step) { notStarted.push(node.key); continue; }
    switch (step.status) {
      case "done": case "skipped": done.push(node.key); break;
      case "failed": failed.push(node.key); break;
      case "blocked": blocked.push(node.key); break;
      default: pending.push(node.key);
    }
  }

  // 4. Check artifact readiness for pending steps
  const readyToRun: string[] = [];
  const missingArtifacts: Array<{ step: string; artifact: string; producer: string | undefined }> = [];

  for (const stepKey of [...pending, ...notStarted]) {
    const check = await checkArtifacts(sb, package_id, stepKey);
    if (check.ready) {
      readyToRun.push(stepKey);
    } else if (check.missingArtifact) {
      missingArtifacts.push({
        step: stepKey,
        artifact: check.missingArtifact,
        producer: check.producerStep,
      });
    }
  }

  // 5. Compute critical path (longest path through remaining steps)
  function estimateDuration(key: string): number {
    return avgDurations.get(key) ?? DEFAULT_DURATION_MS;
  }

  function criticalPathFrom(key: string, visited: Set<string>): { path: string[]; durationMs: number } {
    if (visited.has(key) || done.includes(key)) return { path: [], durationMs: 0 };
    visited.add(key);

    const node = PIPELINE_GRAPH.find(n => n.key === key);
    if (!node) return { path: [], durationMs: 0 };

    const stepDuration = estimateDuration(key);

    // Find downstream steps (steps that depend on this one)
    const downstream = PIPELINE_GRAPH.filter(n =>
      n.dependsOn?.includes(key as any) && !done.includes(n.key)
    );

    if (downstream.length === 0) {
      return { path: [key], durationMs: stepDuration };
    }

    // Take the longest downstream path
    let longest = { path: [] as string[], durationMs: 0 };
    for (const ds of downstream) {
      const sub = criticalPathFrom(ds.key, new Set(visited));
      if (sub.durationMs > longest.durationMs) longest = sub;
    }

    return {
      path: [key, ...longest.path],
      durationMs: stepDuration + longest.durationMs,
    };
  }

  // Start critical path from first non-done step
  const remainingSteps = FULL_STEP_ORDER.filter(k => !done.includes(k));
  let criticalPath = { path: [] as string[], durationMs: 0 };
  for (const startKey of remainingSteps) {
    const cp = criticalPathFrom(startKey, new Set());
    if (cp.durationMs > criticalPath.durationMs) criticalPath = cp;
  }

  // 6. Deadlock detection
  const allStuck = remainingSteps.length > 0 &&
    remainingSteps.every(k => blocked.includes(k) || failed.includes(k));

  // 7. Parallelizable count
  const parallelizable = readyToRun.length;

  // 8. Impact-sorted recommendations
  const recommendations = readyToRun
    .map(k => ({ step: k, impact: ARTIFACT_IMPACT.get(k) ?? 0 }))
    .sort((a, b) => b.impact - a.impact);

  return json({
    ok: true,
    package_id,
    summary: {
      total_steps: PIPELINE_GRAPH.length,
      done: done.length,
      pending: pending.length,
      blocked: blocked.length,
      failed: failed.length,
      not_started: notStarted.length,
    },
    estimated_minutes: Math.round(criticalPath.durationMs / 60_000),
    critical_path: criticalPath.path,
    parallelizable,
    deadlock: allStuck,
    deadlock_reason: allStuck
      ? `All ${remainingSteps.length} remaining steps are stuck (${blocked.length} blocked, ${failed.length} failed)`
      : null,
    ready_to_run: recommendations,
    missing_artifacts: missingArtifacts,
    step_details: PIPELINE_GRAPH.map(node => ({
      key: node.key,
      status: stepMap.get(node.key)?.status ?? "not_started",
      weight: node.weight ?? 1,
      artifact_impact: ARTIFACT_IMPACT.get(node.key) ?? 0,
      produces: node.produces,
      requires: node.requires,
      estimated_duration_ms: estimateDuration(node.key),
    })),
  });
});
