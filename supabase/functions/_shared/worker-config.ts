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
  content_runner: { maxConcurrency: 16, claimLimit: 32 },  // Phase C: 12/25 → 16/32 aggressive growth
  job_runner:     { maxConcurrency: 8,  claimLimit: 8 },   // Stage-4: was 5/5
};

export function getRunnerConfig(kind: RunnerKind): RunnerConfig {
  const base = DEFAULTS[kind];
  const maxConcurrency = envInt(`${kind.toUpperCase()}_CONCURRENCY`, base.maxConcurrency);
  const claimLimit     = envInt(`${kind.toUpperCase()}_CLAIM_LIMIT`, base.claimLimit);

  // Hard safety caps (non-negotiable)
  if (kind === "content_runner") {
    return {
      maxConcurrency: Math.min(maxConcurrency, 16),   // Phase C: hard cap 12→16
      claimLimit: Math.min(claimLimit, 32),            // Phase C: hard cap 25→32
    };
  }
  return {
    maxConcurrency: Math.min(maxConcurrency, 10),
    claimLimit: Math.min(claimLimit, 10),
  };
}

// ═══════════════════════════════════════════════════════════════
// SSOT: Track-aware WIP Quotas (Fair Scheduling + Auto-Rebalance)
// ═══════════════════════════════════════════════════════════════

export type TrackKey = "AUSBILDUNG_VOLL" | "EXAM_FIRST" | "STUDIUM";

/** Hard ceiling across all tracks — must match ops_pipeline_config.wip_limit */
export const WIP_TOTAL_CAP = 13;

/**
 * WIP quota per track: max packages in "building" status simultaneously.
 * Env-overridable via WIP_QUOTA_AUSBILDUNG_VOLL / WIP_QUOTA_EXAM_FIRST / WIP_QUOTA_STUDIUM.
 * Phase E: Finish-First — focus on 5-7 packages nearest completion.
 */
export const WIP_QUOTA_DEFAULTS: Record<TrackKey, number> = {
  AUSBILDUNG_VOLL: 5,
  EXAM_FIRST: 2,
  STUDIUM: 2,
};

export function getTrackQuota(track: TrackKey): number {
  return envInt(`WIP_QUOTA_${track}`, WIP_QUOTA_DEFAULTS[track]);
}

/** Acquisition order: primary track first, then secondary tracks. */
export const TRACK_ACQUISITION_ORDER: TrackKey[] = ["AUSBILDUNG_VOLL", "STUDIUM", "EXAM_FIRST"];

// ═══════════════════════════════════════════════════════════════
// Auto-Rebalance: lend idle track slots to hungry tracks
// ═══════════════════════════════════════════════════════════════

export interface TrackStats {
  active: number;   // currently building packages
  quota: number;    // base quota for this track
  targets: number;  // eligible candidates found this tick
}

/**
 * Dynamically rebalances WIP quotas each runner tick.
 * If a track has 0 targets, its quota is lent to tracks that do.
 * Total never exceeds WIP_TOTAL_CAP. Every track with targets gets ≥1 slot.
 */
export function rebalanceQuotas(
  stats: Record<TrackKey, TrackStats>,
): Record<TrackKey, number> {
  const tracks = Object.keys(stats) as TrackKey[];
  const effective: Record<string, number> = {};

  // Start with base quotas
  for (const t of tracks) effective[t] = stats[t].quota;

  // Collect lendable slots from idle tracks
  let lendable = 0;
  for (const t of tracks) {
    if (stats[t].targets <= 0) {
      lendable += effective[t];
      effective[t] = 0;
    }
  }

  // Distribute lendable proportionally to hungry tracks (by target count)
  const hungry = tracks
    .filter((t) => stats[t].targets > 0)
    .sort((a, b) => stats[b].targets - stats[a].targets);

  if (hungry.length > 0 && lendable > 0) {
    const totalTargets = hungry.reduce((s, t) => s + stats[t].targets, 0);
    let distributed = 0;
    for (let i = 0; i < hungry.length; i++) {
      const t = hungry[i];
      const share = i === hungry.length - 1
        ? lendable - distributed  // last track gets remainder
        : Math.floor((stats[t].targets / totalTargets) * lendable);
      effective[t] += share;
      distributed += share;
    }
  }

  // Enforce total cap
  const total = tracks.reduce((s, t) => s + effective[t], 0);
  if (total > WIP_TOTAL_CAP) {
    let over = total - WIP_TOTAL_CAP;
    const ordered = [...tracks].sort((a, b) => effective[b] - effective[a]);
    for (const t of ordered) {
      if (over <= 0) break;
      const cut = Math.min(over, effective[t]);
      effective[t] -= cut;
      over -= cut;
    }
  }

  // Guarantee ≥1 slot for any track with targets (anti-deadlock)
  for (const t of tracks) {
    if (stats[t].targets > 0 && effective[t] === 0) effective[t] = 1;
  }

  return effective as Record<TrackKey, number>;
}
