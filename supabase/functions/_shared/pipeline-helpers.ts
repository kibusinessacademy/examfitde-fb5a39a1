/**
 * pipeline-helpers.ts — Shared utilities for pipeline-runner
 * Extracted to reduce bundle size of the main edge function.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { FULL_STEP_ORDER, type PipelineStepKey } from "./job-map.ts";

export type StepKey = PipelineStepKey;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

export async function safeRpc(
  sb: ReturnType<typeof createClient>,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[runner] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[runner] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
  }
}

export async function safeQuery(promise: PromiseLike<unknown>, label?: string) {
  try {
    return await promise;
  } catch (e) {
    console.warn(`[runner] safeQuery${label ? ` (${label})` : ''} error:`, (e as Error).message);
    return null;
  }
}

export interface LearningContentProgress {
  ok: boolean;
  package_id?: string;
  course_id?: string;
  total?: number;
  real?: number;
  placeholder?: number;
}

export async function getLearningContentProgress(
  sb: ReturnType<typeof createClient>,
  packageId: string,
): Promise<LearningContentProgress | null> {
  const { data } = await sb.rpc("get_learning_content_progress", {
    p_package_id: packageId,
    p_min_chars: 200,
  });
  return (data as LearningContentProgress | null) ?? null;
}

export interface StepRow {
  step_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  timeout_seconds?: number;
  started_at?: string;
  meta?: Record<string, unknown> | null;
  job_id?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
}

/** Classify whether a job error is transient (503/timeout/rate-limit) */
export function isTransientStepError(errorMsg: string): boolean {
  const msg = (errorMsg ?? "").toLowerCase();
  const TRANSIENT = [
    "503", "502", "504", "service unavailable", "bad gateway",
    "timeout", "timed out", "llm_timeout", "llm_empty_response",
    "rate limit", "rate_limit", "429",
    "all providers failed", "fetch failed", "network error",
    "econnreset", "econnrefused", "socket hang up",
    "connection closed", "connection reset",
    "empty response", "transient",
    "upstream", "temporarily unavailable", "overloaded",
    "unknown_edge_failure",
  ];
  return TRANSIENT.some(p => msg.includes(p));
}

/**
 * Build a track-aware step order by filtering FULL_STEP_ORDER
 * to only include steps that actually exist in the package's DB rows.
 */
export function buildStepOrder(steps: { step_key: string }[]): StepKey[] {
  const existing = new Set(steps.map(s => s.step_key));
  return FULL_STEP_ORDER.filter(k => existing.has(k));
}

// ── State machine: pick next actionable step ──
export type StepAction =
  | { action: "enqueue"; stepKey: StepKey }
  | { action: "poll"; stepKey: StepKey; jobId: string }
  | { action: "exhausted"; stepKey: StepKey }
  | { action: "timed_out"; stepKey: StepKey }
  | { action: "wait"; stepKey: StepKey }
  | null;

export function pickNextAction(steps: StepRow[], stepOrder: StepKey[]): StepAction {
  const byKey = new Map<string, StepRow>();
  for (const s of steps) byKey.set(s.step_key, s);

  for (const k of stepOrder) {
    const s = byKey.get(k);
    if (!s) continue;

    if (s.status === "done" || s.status === "skipped") continue;
    if (s.status === "blocked") continue;

    // Respect next_run_at — step in backoff BLOCKS later steps (strict sequencing)
    const nra = (s.meta as Record<string, unknown>)?.next_run_at;
    if (typeof nra === "string") {
      const nraMs = Date.parse(nra);
      if (!Number.isNaN(nraMs) && nraMs > Date.now()) {
        return { action: "wait", stepKey: k };
      }
    }

    // Poll if step has a linked job
    if ((s.status === "enqueued" || s.status === "running" || s.status === "timeout") && s.job_id) {
      return { action: "poll", stepKey: k, jobId: s.job_id };
    }

    // Running WITHOUT job_id = orphaned step
    if (s.status === "running" && !s.job_id) {
      console.warn(`[runner] ⚠️ Step ${k} is 'running' without job_id (orphaned) — will reset and re-enqueue`);
      return { action: "enqueue", stepKey: k };
    }

    // Enqueued WITHOUT job_id = same orphan class
    if (s.status === "enqueued" && !s.job_id) {
      console.warn(`[runner] ⚠️ Step ${k} is 'enqueued' without job_id (orphaned) — will re-enqueue`);
      return { action: "enqueue", stepKey: k };
    }

    if (s.status === "running") {
      console.warn(`[runner] Unexpected: step ${k} is running but wasn't caught by earlier checks`);
      return null;
    }

    // Timeout WITHOUT job_id = needs re-enqueue
    if (s.status === "timeout" && !s.job_id) {
      if (s.attempts < s.max_attempts) {
        return { action: "enqueue", stepKey: k };
      }
      return { action: "exhausted", stepKey: k };
    }

    // Terminal escalation guard: never re-dispatch steps with kill-switch or terminal errors
    if (s.status === "failed") {
      const lastErr = String(s.last_error || "");
      const sMeta = (s.meta ?? {}) as Record<string, unknown>;
      const isTerminal =
        sMeta.terminal_escalation === true ||
        /kill-switch|QG FAIL ESCALATED|terminal.escalation|AUTO_HEAL_EXHAUSTED/i.test(lastErr);
      if (isTerminal) {
        continue; // Skip — terminally failed, must not be re-dispatched
      }
    }

    const retryable = s.status === "queued" || s.status === "failed" || s.status === "timeout";
    if (retryable && s.attempts < s.max_attempts) {
      return { action: "enqueue", stepKey: k };
    }
    if (retryable && s.attempts >= s.max_attempts) {
      return { action: "exhausted", stepKey: k };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// Parallel Branch Awareness — DAG-based multi-action selection
// ═══════════════════════════════════════════════════════════════

import { PIPELINE_GRAPH, type PipelineStepKey } from "./job-map.ts";
import { isCapabilityGranted } from "./capability-gating.ts";

/**
 * Returns ALL independently actionable steps (parallel branches).
 * After validate_learning_content, three branches can run in parallel:
 *   - auto_seed_exam_blueprints → ... → elite_harden → ...
 *   - generate_lesson_minichecks → validate_lesson_minichecks
 *   - generate_handbook → ... → validate_handbook_depth
 *
 * A step is independently actionable if ALL its DAG predecessors are done/skipped,
 * OR if validate_learning_content has granted capabilities for that step
 * (capability-aware routing for repair_required packages).
 */
export function pickParallelActions(steps: StepRow[], stepOrder: StepKey[]): StepAction[] {
  const byKey = new Map<string, StepRow>();
  for (const s of steps) byKey.set(s.step_key, s);

  // Build DAG dependency lookup
  const dagDeps = new Map<string, string[]>();
  for (const node of PIPELINE_GRAPH) {
    dagDeps.set(node.key, node.dependsOn ?? []);
  }

  function areDependenciesMet(key: string): boolean {
    const deps = dagDeps.get(key) ?? [];
    return deps.every(dep => {
      const s = byKey.get(dep);
      if (!s) return false;
      if (s.status === "done" || s.status === "skipped") return true;

      // Capability-aware: if dep is validate_learning_content and it has
      // granted this step via capabilities, treat as met
      if (dep === "validate_learning_content") {
        const meta = (s.meta ?? {}) as Record<string, unknown>;
        return isCapabilityGranted(key, meta);
      }

      return false;
    });
  }

  const actions: StepAction[] = [];
  const blockedByBackoff = new Set<string>();

  for (const k of stepOrder) {
    const s = byKey.get(k);
    if (!s) continue;
    if (s.status === "done" || s.status === "skipped") continue;
    if (s.status === "blocked") continue;

    // Check DAG dependencies are met
    if (!areDependenciesMet(k)) continue;

    // Check if any dependency is in backoff (blocks this branch)
    const deps = dagDeps.get(k) ?? [];
    if (deps.some(d => blockedByBackoff.has(d))) {
      blockedByBackoff.add(k);
      continue;
    }

    // Respect next_run_at
    const nra = (s.meta as Record<string, unknown>)?.next_run_at;
    if (typeof nra === "string") {
      const nraMs = Date.parse(nra);
      if (!Number.isNaN(nraMs) && nraMs > Date.now()) {
        blockedByBackoff.add(k);
        continue;
      }
    }

    // Poll
    if ((s.status === "enqueued" || s.status === "running" || s.status === "timeout") && s.job_id) {
      actions.push({ action: "poll", stepKey: k, jobId: s.job_id });
      continue;
    }

    // Orphaned
    if ((s.status === "running" || s.status === "enqueued") && !s.job_id) {
      actions.push({ action: "enqueue", stepKey: k });
      continue;
    }

    if (s.status === "running") continue;

    if (s.status === "timeout" && !s.job_id) {
      if (s.attempts < s.max_attempts) {
        actions.push({ action: "enqueue", stepKey: k });
      } else {
        actions.push({ action: "exhausted", stepKey: k });
      }
      continue;
    }

    // Terminal escalation guard (same as pickNextAction)
    if (s.status === "failed") {
      const lastErr = String(s.last_error || "");
      const sMeta = (s.meta ?? {}) as Record<string, unknown>;
      const isTerminal =
        sMeta.terminal_escalation === true ||
        /kill-switch|QG FAIL ESCALATED|terminal.escalation|AUTO_HEAL_EXHAUSTED/i.test(lastErr);
      if (isTerminal) continue;
    }

    const retryable = s.status === "queued" || s.status === "failed" || s.status === "timeout";
    if (retryable && s.attempts < s.max_attempts) {
      actions.push({ action: "enqueue", stepKey: k });
    } else if (retryable && s.attempts >= s.max_attempts) {
      actions.push({ action: "exhausted", stepKey: k });
    }
  }

  return actions;
}

export interface StepClassContext {
  limits: Record<string, number>;
  load: Record<string, Set<string>>;
}
