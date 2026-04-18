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
  // v8.0: Hardcap raised to 50 (per user request 2026-04-18).
  // RISK: Edge-Runtime hard limit ~110s — relies on HEAVY_JOB_TICK_BUDGET_SECONDS=85
  // and stale-lock guard (3min cleanup) to prevent runner pod aborts.
  // content-runner: 280s loop with 1.5s sleep → can process ~25 light jobs per cycle.
  // job-runner: 110s budget, most control jobs complete in <5s → can process 15+ per cycle.
  content_runner: { maxConcurrency: 50, claimLimit: 50 },
  job_runner:     { maxConcurrency: 50, claimLimit: 50 },
};

export function getRunnerConfig(kind: RunnerKind): RunnerConfig {
  const base = DEFAULTS[kind];
  const maxConcurrency = envInt(`${kind.toUpperCase()}_CONCURRENCY`, base.maxConcurrency);
  const claimLimit     = envInt(`${kind.toUpperCase()}_CLAIM_LIMIT`, base.claimLimit);

  // Hard safety caps (non-negotiable)
  // Hard safety caps — prevent env overrides from re-introducing the stale-lock problem
  if (kind === "content_runner") {
    return {
      maxConcurrency: Math.min(maxConcurrency, 10),
      claimLimit: Math.min(claimLimit, 10),
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

export type TrackKey = "AUSBILDUNG_VOLL" | "EXAM_FIRST" | "EXAM_FIRST_PLUS" | "STUDIUM";

/** Hard ceiling across all tracks — must match ops_pipeline_config.wip_total_cap */
export const WIP_TOTAL_CAP = 13;

/** Bonus WIP slots reserved for repair work (integrity, healing, requeue) */
export const WIP_BONUS_REPAIR_SLOTS = 5;

/** Effective cap = base + repair bonus */
export const WIP_EFFECTIVE_MAX = WIP_TOTAL_CAP + WIP_BONUS_REPAIR_SLOTS; // 13 + 5 = 18

/**
 * WIP quota per track: max packages in "building" status simultaneously.
 * Env-overridable via WIP_QUOTA_<TRACK>.
 */
export const WIP_QUOTA_DEFAULTS: Record<TrackKey, number> = {
  AUSBILDUNG_VOLL: 5,
  EXAM_FIRST_PLUS: 4,
  EXAM_FIRST: 2,
  STUDIUM: 2,
};

export function getTrackQuota(track: TrackKey): number {
  return envInt(`WIP_QUOTA_${track}`, WIP_QUOTA_DEFAULTS[track]);
}

/** Acquisition order: primary track first, then secondary tracks. */
export const TRACK_ACQUISITION_ORDER: TrackKey[] = ["EXAM_FIRST_PLUS", "AUSBILDUNG_VOLL", "STUDIUM", "EXAM_FIRST"];

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

  // ── CRITICAL FIX: Don't zero out quotas when no queued targets exist ──
  // If ALL tracks have targets=0 but some have active building packages,
  // keep base quotas so the runner can still process existing building packages.
  // Only lend quotas when there ARE hungry tracks to lend to.
  const anyHungry = tracks.some((t) => stats[t].targets > 0);
  const anyActive = tracks.some((t) => stats[t].active > 0);

  if (anyHungry) {
    // Normal rebalancing: lend from idle tracks to hungry ones
    let lendable = 0;
    for (const t of tracks) {
      if (stats[t].targets <= 0 && stats[t].active <= 0) {
        lendable += effective[t];
        effective[t] = 0;
      }
    }

    const hungry = tracks
      .filter((t) => stats[t].targets > 0)
      .sort((a, b) => stats[b].targets - stats[a].targets);

    if (hungry.length > 0 && lendable > 0) {
      const totalTargets = hungry.reduce((s, t) => s + stats[t].targets, 0);
      let distributed = 0;
      for (let i = 0; i < hungry.length; i++) {
        const t = hungry[i];
        const share = i === hungry.length - 1
          ? lendable - distributed
          : Math.floor((stats[t].targets / totalTargets) * lendable);
        effective[t] += share;
        distributed += share;
      }
    }
  } else if (anyActive) {
    // No queued targets at all, but building packages exist.
    // Keep quotas at least equal to active count so runner can process them.
    for (const t of tracks) {
      effective[t] = Math.max(effective[t], stats[t].active);
    }
  }
  // If neither hungry nor active, quotas stay at base (harmless — nothing to process)

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

  // Guarantee ≥1 slot for any track with targets OR active work (anti-deadlock)
  for (const t of tracks) {
    if ((stats[t].targets > 0 || stats[t].active > 0) && effective[t] === 0) {
      effective[t] = 1;
    }
  }

  return effective as Record<TrackKey, number>;
}
