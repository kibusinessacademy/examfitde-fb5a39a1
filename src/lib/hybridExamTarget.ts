/**
 * HYBRID TARGET ENGINE — SSOT für dynamische Exam-Targets
 * 
 * Formel:
 *   exam_target = (base_by_duration + complexity_bonus + domain_count_factor
 *                  + math_factor + oral_factor) * certification_multiplier
 * 
 * Hard-Cap: MAX_QUESTIONS_PER_PACKAGE (2000) from examPoolLimits SSOT
 * Ship-Ready: ~85% des Targets
 * 
 * Genutzt von:
 *   - build-course-package
 *   - package-generate-exam-pool
 *   - package-queue-next
 *   - Admin Dashboard
 *   - SEO Meta-Templates
 */

export interface HybridTargetInput {
  /** Ausbildungsdauer in Monaten (null = 36 default) */
  durationMonths: number | null | undefined;
  /** Track: AUSBILDUNG_VOLL, EXAM_FIRST, etc. */
  track: string;
  /** Komplexitätsfaktor (1.0 = Standard, 1.5 = komplex) */
  examComplexityScore: number;
  /** Anteil Rechenaufgaben (0.0 - 1.0) */
  mathRatio: number;
  /** Mündliche Prüfungskomponente vorhanden */
  oralComponent: boolean;
  /** Anzahl Lernfelder/Domänen */
  learningFieldCount: number;
  /** certification_level: ausbildung | fachwirt | meister | sachkunde | projektmanagement */
  certificationLevel: string;
}

export interface HybridTargetResult {
  /** Finales Exam-Target (Hard-Cap: 2000) */
  target: number;
  /** Ship-Ready Minimum */
  shipTarget: number;
  /** Marketing-Label z.B. "1.200+" */
  label: string;
  /** SEO-taugliche Beschreibung */
  marketingLabel: string;
  /** Breakdown der Berechnung */
  breakdown: {
    base: number;
    complexityBonus: number;
    domainFactor: number;
    mathFactor: number;
    oralFactor: number;
    multiplier: number;
    rawTotal: number;
  };
  /** Dynamische Schwierigkeitsverteilung basierend auf Target */
  difficultyDistribution: {
    easy: number;
    medium: number;
    hard: number;
    very_hard: number;
  };
  /** Dynamischer Question-Type-Mix basierend auf mathRatio */
  questionTypeMix: {
    mc_single: number;
    mc_multiple: number;
    calculation: number;
    case_study: number;
    transfer: number;
  };
}

import { MAX_QUESTIONS_PER_PACKAGE } from './examPoolLimits';

const HARD_CAP = MAX_QUESTIONS_PER_PACKAGE; // SSOT: 2000

function getBaseByDuration(months: number | null | undefined, track: string): number {
  if (track === 'EXAM_FIRST' || track === 'EXAM_FIRST_PLUS') return 1000;
  const m = months ?? 36;
  if (m <= 24) return 500;
  if (m <= 30) return 700;
  return 850;
}

function getCertificationMultiplier(level: string): number {
  switch (level) {
    case 'fachwirt':
    case 'meister':
      return 1.2;
    case 'sachkunde':
      return 0.9;
    case 'projektmanagement':
      return 1.1;
    default:
      return 1.0; // ausbildung
  }
}

/**
 * Einheitliche Schwierigkeitsverteilung für alle Kurse
 * SSOT: easy=10%, medium=45%, hard=35%, very_hard=10%
 */
function getDynamicDifficulty(_target: number): HybridTargetResult['difficultyDistribution'] {
  return { easy: 0.10, medium: 0.45, hard: 0.35, very_hard: 0.10 };
}

/**
 * Dynamischer Question-Type-Mix basierend auf mathRatio
 */
function getDynamicQuestionTypeMix(mathRatio: number): HybridTargetResult['questionTypeMix'] {
  // Mehr Rechenanteil → mehr calculation, weniger mc_single
  const calcShare = Math.min(0.35, Math.max(0.10, mathRatio * 1.2));
  const remaining = 1.0 - calcShare;

  return {
    mc_single: remaining * 0.30,
    mc_multiple: remaining * 0.22,
    calculation: calcShare,
    case_study: remaining * 0.33,
    transfer: remaining * 0.15,
  };
}

function formatLabel(target: number): string {
  if (target >= 1000) {
    return `${(Math.floor(target / 100) * 100).toLocaleString('de-DE')}+`;
  }
  return `${Math.floor(target / 50) * 50}+`;
}

/**
 * Zentrale Hybrid-Target-Berechnung — SSOT
 */
export function calculateHybridTarget(input: HybridTargetInput): HybridTargetResult {
  const base = getBaseByDuration(input.durationMonths, input.track);
  const complexityBonus = Math.round(100 * (input.examComplexityScore ?? 1.0));
  const domainFactor = (input.learningFieldCount ?? 0) * 15;
  const mathFactor = Math.round((input.mathRatio ?? 0.15) * 300);
  const oralFactor = input.oralComponent ? 150 : 0;
  const multiplier = getCertificationMultiplier(input.certificationLevel ?? 'ausbildung');

  const rawTotal = Math.round(
    (base + complexityBonus + domainFactor + mathFactor + oralFactor) * multiplier
  );

  const target = Math.min(rawTotal, HARD_CAP);
  const shipTarget = Math.round(target * 0.85);

  const difficultyDistribution = getDynamicDifficulty(target);
  const questionTypeMix = getDynamicQuestionTypeMix(input.mathRatio ?? 0.15);

  return {
    target,
    shipTarget,
    label: formatLabel(target),
    marketingLabel: `über ${formatLabel(target)} Prüfungsfragen`,
    breakdown: {
      base,
      complexityBonus,
      domainFactor,
      mathFactor,
      oralFactor,
      multiplier,
      rawTotal,
    },
    difficultyDistribution,
    questionTypeMix,
  };
}

/**
 * Defaults für fehlende Zertifizierungs-Daten (Backward-Kompatibilität)
 */
export function calculateHybridTargetFromDefaults(
  durationMonths: number | null | undefined,
  track: string = 'AUSBILDUNG_VOLL',
): HybridTargetResult {
  return calculateHybridTarget({
    durationMonths,
    track,
    examComplexityScore: 1.0,
    mathRatio: 0.15,
    oralComponent: false,
    learningFieldCount: 0,
    certificationLevel: 'ausbildung',
  });
}

/**
 * Deno-kompatible Version für Edge Functions (kein React-Import)
 * Gibt nur die essenziellen Werte zurück
 */
export function calculateHybridTargetForPipeline(input: HybridTargetInput): {
  target: number;
  shipTarget: number;
  difficultyDistribution: HybridTargetResult['difficultyDistribution'];
  questionTypeMix: HybridTargetResult['questionTypeMix'];
} {
  const result = calculateHybridTarget(input);
  return {
    target: result.target,
    shipTarget: result.shipTarget,
    difficultyDistribution: result.difficultyDistribution,
    questionTypeMix: result.questionTypeMix,
  };
}
