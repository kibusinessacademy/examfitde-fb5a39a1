/**
 * SSOT: Edge Time Budget Governance
 *
 * No generator should hardcode timeouts/budgets.
 * Budgets must be defined centrally and consumed consistently.
 */

export type BudgetKey =
  | "runner_claim"
  | "exam_pool_fanout"
  | "learning_content"
  | "lesson_single"
  | "handbook"
  | "glossary"
  | "oral_exam"
  | "lesson_minichecks"
  | "integrity_check"
  | "quality_council"
  | "bulk_import";

export interface TimeBudget {
  /** Total allowed runtime budget for an invocation */
  ms: number;
  /** When to start "soft stop" (stop scheduling new LLM calls) */
  softStopMs: number;
}

function envInt(name: string, fallback: number): number {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const DEFAULTS: Record<BudgetKey, TimeBudget> = {
  runner_claim:       { ms: 55_000, softStopMs: 45_000 },
  exam_pool_fanout:   { ms: 45_000, softStopMs: 35_000 },
  learning_content:   { ms: 50_000, softStopMs: 38_000 },  // v11: raised — Anthropic/OpenAI are reliable, maximize LLM window
  lesson_single:      { ms: 50_000, softStopMs: 38_000 },  // v11: raised — aligned with learning_content
  handbook:           { ms: 55_000, softStopMs: 48_000 }, // v17: single provider per call — maximize available time
  glossary:           { ms: 45_000, softStopMs: 35_000 },
  oral_exam:          { ms: 45_000, softStopMs: 35_000 },
  lesson_minichecks:  { ms: 50_000, softStopMs: 38_000 },  // v3: raised — 3 targets × ~12s = ~36s, needs headroom
  integrity_check:    { ms: 50_000, softStopMs: 40_000 },  // v1: paginated fetch, soft-stop before DB writes
  quality_council:    { ms: 45_000, softStopMs: 35_000 },  // v1: read-only gate, fast
  bulk_import:        { ms: 50_000, softStopMs: 40_000 },  // v1: per-row processing, chunked
};

export function getTimeBudget(key: BudgetKey): TimeBudget {
  const base = DEFAULTS[key];
  const ms = envInt(`BUDGET_${key.toUpperCase()}_MS`, base.ms);
  const soft = envInt(`BUDGET_${key.toUpperCase()}_SOFT_MS`, base.softStopMs);
  return { ms, softStopMs: Math.min(soft, ms - 2_000) };
}

export function makeAbortController(key: BudgetKey): {
  controller: AbortController;
  timeout: number;
  budget: TimeBudget;
} {
  const budget = getTimeBudget(key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), budget.ms) as unknown as number;
  return { controller, timeout, budget };
}

export function shouldSoftStop(startMs: number, key: BudgetKey): boolean {
  const budget = getTimeBudget(key);
  return Date.now() - startMs >= budget.softStopMs;
}
