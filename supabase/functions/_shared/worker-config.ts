/**
 * SSOT: Worker Concurrency Governance
 *
 * Prevents accidental high concurrency that kills Edge functions.
 * Concurrency must be deterministic, safe defaults, env-overridable.
 */

export type RunnerKind = "content_runner" | "job_runner";

export interface RunnerConfig {
  maxConcurrency: number;
  claimLimit: number;
}

function envInt(name: string, fallback: number): number {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const DEFAULTS: Record<RunnerKind, RunnerConfig> = {
  content_runner: { maxConcurrency: 1, claimLimit: 1 },
  job_runner:     { maxConcurrency: 5, claimLimit: 5 },
};

export function getRunnerConfig(kind: RunnerKind): RunnerConfig {
  const base = DEFAULTS[kind];
  const maxConcurrency = envInt(`${kind.toUpperCase()}_CONCURRENCY`, base.maxConcurrency);
  const claimLimit     = envInt(`${kind.toUpperCase()}_CLAIM_LIMIT`, base.claimLimit);

  // Hard safety caps (non-negotiable)
  if (kind === "content_runner") {
    return {
      maxConcurrency: Math.min(maxConcurrency, 2),
      claimLimit: Math.min(claimLimit, 2),
    };
  }
  return {
    maxConcurrency: Math.min(maxConcurrency, 10),
    claimLimit: Math.min(claimLimit, 10),
  };
}
