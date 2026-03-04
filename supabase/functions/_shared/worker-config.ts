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
  content_runner: { maxConcurrency: 8, claimLimit: 16 },  // Stage-4: was 6/12
  job_runner:     { maxConcurrency: 8, claimLimit: 8 },   // Stage-4: was 5/5
};

export function getRunnerConfig(kind: RunnerKind): RunnerConfig {
  const base = DEFAULTS[kind];
  const maxConcurrency = envInt(`${kind.toUpperCase()}_CONCURRENCY`, base.maxConcurrency);
  const claimLimit     = envInt(`${kind.toUpperCase()}_CLAIM_LIMIT`, base.claimLimit);

  // Hard safety caps (non-negotiable)
  if (kind === "content_runner") {
    return {
      maxConcurrency: Math.min(maxConcurrency, 8),
      claimLimit: Math.min(claimLimit, 16),
    };
  }
  return {
    maxConcurrency: Math.min(maxConcurrency, 10),
    claimLimit: Math.min(claimLimit, 10),
  };
}

// ═══════════════════════════════════════════════════════════════
// SSOT: Track-aware WIP Quotas (Fair Scheduling)
// ═══════════════════════════════════════════════════════════════

export type TrackKey = "AUSBILDUNG_VOLL" | "EXAM_FIRST";

/**
 * WIP quota per track: max packages in "building" status simultaneously.
 * Env-overridable via WIP_QUOTA_AUSBILDUNG_VOLL / WIP_QUOTA_EXAM_FIRST.
 * Sum of all quotas may exceed global max_concurrent_packages — the global
 * cap in acquire_next_package_lease_v2 provides the hard ceiling.
 */
export const WIP_QUOTA_DEFAULTS: Record<TrackKey, number> = {
  AUSBILDUNG_VOLL: 12,
  EXAM_FIRST: 3,
};

export function getTrackQuota(track: TrackKey): number {
  return envInt(`WIP_QUOTA_${track}`, WIP_QUOTA_DEFAULTS[track]);
}

/** Acquisition order: which track gets slots first. AUSBILDUNG_VOLL goes first (primary track). */
export const TRACK_ACQUISITION_ORDER: TrackKey[] = ["AUSBILDUNG_VOLL", "EXAM_FIRST"];
