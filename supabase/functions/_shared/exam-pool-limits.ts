/**
 * EXAM POOL LIMITS — Deno Edge Function Version (SSOT)
 *
 * Exakte Kopie der Logik aus src/lib/examPoolLimits.ts
 * für Deno Edge Functions (kein Node/React-Import)
 *
 * Operative Regel:
 *   < 500         → insufficient (Publish blockiert)
 *   500–999       → good (publishable)
 *   1000–2000     → strong (optimal)
 *   > 2000        → oversized (Generator stoppt)
 *
 * Rebuild-Pakete (is_rebuild=true) erhalten temporär +10%
 * über dem normalen Max-Cap, um Rebalance-Spielraum zu schaffen.
 * Nach erfolgreicher Re-Validierung werden Überschuss-Fragen getrimmt.
 */

export const MIN_QUESTIONS_PER_PACKAGE = 500;
export const TARGET_QUESTIONS_PER_PACKAGE = 1000;
export const MAX_QUESTIONS_PER_PACKAGE = 2200;
export const REBUILD_HEADROOM_PCT = 0.10; // +10% for rebuild packages

export type PoolSizeStatus = 'insufficient' | 'good' | 'strong' | 'oversized';

export function getPoolSizeStatus(totalQuestions: number): PoolSizeStatus {
  if (totalQuestions < MIN_QUESTIONS_PER_PACKAGE) return 'insufficient';
  if (totalQuestions < TARGET_QUESTIONS_PER_PACKAGE) return 'good';
  if (totalQuestions <= MAX_QUESTIONS_PER_PACKAGE) return 'strong';
  return 'oversized';
}

export interface TieredTarget {
  min: number;
  target: number;
  max: number;
  tier: 'small' | 'medium' | 'large';
}

export function getTieredTarget(
  certificationLevel: string,
  track: string,
): TieredTarget {
  if (
    track === 'EXAM_FIRST' ||
    track === 'EXAM_FIRST_PLUS' ||
    certificationLevel === 'fachwirt' ||
    certificationLevel === 'meister'
  ) {
    return { min: 500, target: 1200, max: 2000, tier: 'large' };
  }

  if (
    certificationLevel === 'sachkunde' ||
    certificationLevel === 'projektmanagement'
  ) {
    return { min: 500, target: 800, max: 1500, tier: 'small' };
  }

  return { min: 500, target: 1000, max: 2000, tier: 'medium' };
}

/**
 * Returns the effective max cap, boosted by +10% for rebuild packages.
 */
export function getEffectiveMaxCap(
  certificationLevel: string,
  track: string,
  isRebuild: boolean,
): number {
  const tiered = getTieredTarget(certificationLevel, track);
  const baseCap = Math.min(tiered.max, MAX_QUESTIONS_PER_PACKAGE);
  if (isRebuild) {
    return Math.ceil(baseCap * (1 + REBUILD_HEADROOM_PCT));
  }
  return baseCap;
}

export function getRemainingGenerationBudget(
  currentCount: number,
  certificationLevel: string = 'ausbildung',
  track: string = 'AUSBILDUNG_VOLL',
  isRebuild: boolean = false,
): number {
  const cap = getEffectiveMaxCap(certificationLevel, track, isRebuild);
  return Math.max(0, cap - currentCount);
}
