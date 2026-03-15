/**
 * kg-rollout.ts — Deterministic KG rollout gate (3-layer check).
 *
 * Gate logic (ALL must be true):
 *   1. kg_exam_pool_enabled = true          (global kill-switch)
 *   2. kg_exam_pool_rollout_pct > 0         (% rollout)
 *   3. kg_rollout_curriculum_<id> = true    (curriculum has enough KG data)
 *   4. stableHash(blueprintId) % 100 < pct  (deterministic bucket)
 *
 * Kill-switch: set `kg_exam_pool_enabled` to `false` in DB — no redeploy.
 */

export interface KGRolloutDecision {
  enabled: boolean;
  rolloutPct: number;
  curriculumReady: boolean;
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

let _cachedConfig: { enabled: boolean; pct: number; readyCurricula: Set<string> } | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 min

async function loadConfig(sb: any): Promise<{ enabled: boolean; pct: number; readyCurricula: Set<string> }> {
  const now = Date.now();
  if (_cachedConfig && now - _cachedAt < CACHE_TTL_MS) return _cachedConfig;

  let enabled = false;
  let pct = 0;
  const readyCurricula = new Set<string>();

  try {
    const { data } = await sb
      .from("ops_pipeline_config")
      .select("key, value")
      .or("key.eq.kg_exam_pool_enabled,key.eq.kg_exam_pool_rollout_pct,key.like.kg_rollout_curriculum_%");

    for (const row of data || []) {
      const val = typeof row.value === "string" ? row.value : String(row.value ?? "");
      const clean = val.replace(/^"|"$/g, "");
      if (row.key === "kg_exam_pool_enabled") enabled = clean === "true";
      else if (row.key === "kg_exam_pool_rollout_pct") pct = parseInt(clean, 10) || 0;
      else if (row.key.startsWith("kg_rollout_curriculum_") && clean === "true") {
        const currId = row.key.replace("kg_rollout_curriculum_", "");
        readyCurricula.add(currId);
      }
    }
  } catch (e) {
    console.warn(`[kg-rollout] Config load failed: ${(e as Error).message}`);
  }

  _cachedConfig = { enabled, pct, readyCurricula };
  _cachedAt = now;
  return _cachedConfig;
}

/**
 * Check if KG context injection should be used for a given blueprint.
 * Requires curriculumId to check the curriculum-level ready flag.
 */
export async function shouldInjectKG(
  sb: any,
  blueprintId: string,
  curriculumId?: string,
): Promise<KGRolloutDecision> {
  const { enabled, pct, readyCurricula } = await loadConfig(sb);

  if (!enabled || pct <= 0) {
    return { enabled, rolloutPct: pct, curriculumReady: false, blueprintInRollout: false };
  }

  // Layer 2: Curriculum must be KG-ready
  const currReady = curriculumId ? readyCurricula.has(curriculumId) : readyCurricula.size === 0;
  if (!currReady) {
    return { enabled: true, rolloutPct: pct, curriculumReady: false, blueprintInRollout: false };
  }

  // Layer 3: Deterministic blueprint bucket
  if (pct >= 100) {
    return { enabled: true, rolloutPct: pct, curriculumReady: true, blueprintInRollout: true };
  }

  const hash = stableHash(blueprintId);
  const inRollout = (hash % 100) < pct;

  return { enabled: true, rolloutPct: pct, curriculumReady: true, blueprintInRollout: inRollout };
}

/**
 * Reset config cache (for testing or after config update).
 */
export function resetKGRolloutCache(): void {
  _cachedConfig = null;
  _cachedAt = 0;
}
