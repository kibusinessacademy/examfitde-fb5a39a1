/**
 * STORE.OPS.PREDICTION.OS.1 — Action-level baselines.
 *
 * Derives per-action success / failure / block rates and average durations
 * from historical batch_items and autopilot_actions. Pure & deterministic.
 */
import type {
  ActionBaseline,
  AutopilotActionSnapshot,
  BatchItemSnapshot,
} from "./contracts.ts";

interface Bucket {
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  durations: number[];
}

function newBucket(): Bucket {
  return { total: 0, succeeded: 0, failed: 0, blocked: 0, durations: [] };
}

function classify(status: string): "succeeded" | "failed" | "blocked" | "other" {
  const s = (status || "").toLowerCase();
  if (s === "succeeded" || s === "success" || s === "completed" || s === "ok") return "succeeded";
  if (s === "failed" || s === "error") return "failed";
  if (s === "blocked" || s === "rejected" || s === "denied") return "blocked";
  return "other";
}

export function computeActionBaselines(
  items: BatchItemSnapshot[],
  actions: AutopilotActionSnapshot[],
): ActionBaseline[] {
  const buckets = new Map<string, Bucket>();

  const consume = (
    action_type: string,
    status: string,
    duration_seconds: number | null | undefined,
  ) => {
    const b = buckets.get(action_type) ?? newBucket();
    b.total += 1;
    const c = classify(status);
    if (c === "succeeded") b.succeeded += 1;
    else if (c === "failed") b.failed += 1;
    else if (c === "blocked") b.blocked += 1;
    if (typeof duration_seconds === "number" && Number.isFinite(duration_seconds) && duration_seconds >= 0) {
      b.durations.push(duration_seconds);
    }
    buckets.set(action_type, b);
  };

  for (const it of items) consume(it.action_type, it.status, it.duration_seconds ?? null);
  for (const a of actions) consume(a.action_type, a.status, a.duration_seconds ?? null);

  const out: ActionBaseline[] = [];
  // Deterministic ordering by action_type.
  const keys = [...buckets.keys()].sort();
  for (const k of keys) {
    const b = buckets.get(k)!;
    const avg =
      b.durations.length === 0
        ? null
        : Math.round((b.durations.reduce((s, v) => s + v, 0) / b.durations.length) * 1000) / 1000;
    out.push({
      action_type: k,
      observed_total: b.total,
      observed_succeeded: b.succeeded,
      observed_failed: b.failed,
      observed_blocked: b.blocked,
      success_rate: b.total > 0 ? round3(b.succeeded / b.total) : 0,
      failure_rate: b.total > 0 ? round3(b.failed / b.total) : 0,
      block_rate: b.total > 0 ? round3(b.blocked / b.total) : 0,
      average_duration_seconds: avg,
      duration_sample_count: b.durations.length,
    });
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
