/**
 * EXAM POOL LIMITS — SSOT für Fragenlimits pro Paket
 *
 * Operative Regel:
 *   < 500         → insufficient (Publish blockiert)
 *   500–999       → good (publishable)
 *   1000–2000     → strong (optimal)
 *   > 2000        → oversized (Generator stoppt)
 *
 * Certification-Tiers bestimmen den empfohlenen Zielwert:
 *   small   (sachkunde, kurze Berufe)      → 500–800
 *   medium  (standard Ausbildung)          → 800–1200
 *   large   (Fachwirt, Meister, EXAM_FIRST) → 1200–2000
 */

// ─── Hard Constants (nicht überschreibbar) ───────────────────
export const MIN_QUESTIONS_PER_PACKAGE = 500;
export const TARGET_QUESTIONS_PER_PACKAGE = 1000;
export const MAX_QUESTIONS_PER_PACKAGE = 2000;

// ─── Pool Size Status ────────────────────────────────────────
export type PoolSizeStatus = 'insufficient' | 'good' | 'strong' | 'oversized';

export function getPoolSizeStatus(totalQuestions: number): PoolSizeStatus {
  if (totalQuestions < MIN_QUESTIONS_PER_PACKAGE) return 'insufficient';
  if (totalQuestions < TARGET_QUESTIONS_PER_PACKAGE) return 'good';
  if (totalQuestions <= MAX_QUESTIONS_PER_PACKAGE) return 'strong';
  return 'oversized';
}

// ─── Certification-Tiered Targets ────────────────────────────
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
  // Large tier: Fachwirt, Meister, EXAM_FIRST
  if (
    track === 'EXAM_FIRST' ||
    track === 'EXAM_FIRST_PLUS' ||
    certificationLevel === 'fachwirt' ||
    certificationLevel === 'meister'
  ) {
    return { min: 500, target: 1200, max: 2000, tier: 'large' };
  }

  // Small tier: Sachkunde, Projektmanagement
  if (
    certificationLevel === 'sachkunde' ||
    certificationLevel === 'projektmanagement'
  ) {
    return { min: 500, target: 800, max: 1500, tier: 'small' };
  }

  // Medium tier: Standard Ausbildung
  return { min: 500, target: 1000, max: 2000, tier: 'medium' };
}

// ─── Generator Guard ─────────────────────────────────────────
/**
 * Prüft ob noch generiert werden darf.
 * Returns: Anzahl maximal noch zu generierender Fragen (0 = Stop)
 */
export function getRemainingGenerationBudget(
  currentCount: number,
  certificationLevel: string = 'ausbildung',
  track: string = 'AUSBILDUNG_VOLL',
): number {
  const tiered = getTieredTarget(certificationLevel, track);
  // Stop at hard cap
  const cap = Math.min(tiered.max, MAX_QUESTIONS_PER_PACKAGE);
  return Math.max(0, cap - currentCount);
}
