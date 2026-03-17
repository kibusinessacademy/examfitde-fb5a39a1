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
 */

export const MIN_QUESTIONS_PER_PACKAGE = 500;
export const TARGET_QUESTIONS_PER_PACKAGE = 1000;
export const MAX_QUESTIONS_PER_PACKAGE = 2000;

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

export function getRemainingGenerationBudget(
  currentCount: number,
  certificationLevel: string = 'ausbildung',
  track: string = 'AUSBILDUNG_VOLL',
): number {
  const tiered = getTieredTarget(certificationLevel, track);
  const cap = Math.min(tiered.max, MAX_QUESTIONS_PER_PACKAGE);
  return Math.max(0, cap - currentCount);
}
