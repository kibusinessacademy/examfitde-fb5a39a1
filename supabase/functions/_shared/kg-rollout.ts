/**
 * kg-rollout.ts — Deterministic KG rollout gate.
 *
 * Reads `kg_exam_pool_enabled` and `kg_exam_pool_rollout_pct` from
 * ops_pipeline_config. Uses a deterministic hash on the blueprint ID
 * so the same blueprint always gets the same decision within a rollout
 * percentage (stable, reproducible).
 *
 * Kill-switch: set `kg_exam_pool_enabled` to `false` in DB — no redeploy.
 */

export interface KGRolloutDecision {
  enabled: boolean;
  rolloutPct: number;
  blueprintInRollout: boolean;
}

// ── Deterministic hash (stable across invocations) ──

function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── Config cache (per-invocation, avoids N queries for N blueprints) ──

let _cachedConfig: { enabled: boolean; pct: number } | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 min

async function loadConfig(sb: any): Promise<{ enabled: boolean; pct: number }> {
  const now = Date.now();
  if (_cachedConfig && now - _cachedAt < CACHE_TTL_MS) return _cachedConfig;

  let enabled = false;
  let pct = 0;

  try {
    const { data } = await sb
      .from("ops_pipeline_config")
      .select("key, value")
      .in("key", ["kg_exam_pool_enabled", "kg_exam_pool_rollout_pct"]);

    for (const row of data || []) {
      const val = typeof row.value === "string" ? row.value : String(row.value ?? "");
      const clean = val.replace(/^"|"$/g, ""); // strip JSON string quotes
      if (row.key === "kg_exam_pool_enabled") enabled = clean === "true";
      if (row.key === "kg_exam_pool_rollout_pct") pct = parseInt(clean, 10) || 0;
    }
  } catch (e) {
    console.warn(`[kg-rollout] Config load failed: ${(e as Error).message}`);
  }

  _cachedConfig = { enabled, pct };
  _cachedAt = now;
  return _cachedConfig;
}

/**
 * Check if KG context injection should be used for a given blueprint.
 */
export async function shouldInjectKG(
  sb: any,
  blueprintId: string,
): Promise<KGRolloutDecision> {
  const { enabled, pct } = await loadConfig(sb);

  if (!enabled || pct <= 0) {
    return { enabled, rolloutPct: pct, blueprintInRollout: false };
  }

  // 100% = always on
  if (pct >= 100) {
    return { enabled: true, rolloutPct: pct, blueprintInRollout: true };
  }

  const hash = stableHash(blueprintId);
  const inRollout = (hash % 100) < pct;

  return { enabled: true, rolloutPct: pct, blueprintInRollout: inRollout };
}

/**
 * Reset config cache (for testing or after config update).
 */
export function resetKGRolloutCache(): void {
  _cachedConfig = null;
  _cachedAt = 0;
}
