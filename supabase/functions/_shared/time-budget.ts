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
  | "lesson_minichecks";

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
  learning_content:   { ms: 150_000, softStopMs: 120_000 },  // v5.8: 2.5min hard / 2min soft — content gen has ~30s init overhead
  lesson_single:      { ms: 75_000,  softStopMs: 60_000 },   // v7.1: raised from 55/45 — avoid artificial LLM timeouts on tool-call + glossary
  handbook:           { ms: 150_000, softStopMs: 120_000 },  // v5.8: same rationale as learning_content
  glossary:           { ms: 45_000, softStopMs: 35_000 },
  oral_exam:          { ms: 45_000, softStopMs: 35_000 },
  lesson_minichecks:  { ms: 45_000, softStopMs: 35_000 },
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
