/**
 * HYBRID TARGET ENGINE — Deno Edge Function Version (SSOT)
 * 
 * Exakte Kopie der Logik aus src/lib/hybridExamTarget.ts
 * für Deno Edge Functions (kein Node/React-Import)
 */

export interface HybridTargetInput {
  durationMonths: number | null | undefined;
  track: string;
  examComplexityScore: number;
  mathRatio: number;
  oralComponent: boolean;
  learningFieldCount: number;
  certificationLevel: string;
}

export interface HybridTargetResult {
  target: number;
  shipTarget: number;
  label: string;
  marketingLabel: string;
  breakdown: {
    base: number;
    complexityBonus: number;
    domainFactor: number;
    mathFactor: number;
    oralFactor: number;
    multiplier: number;
    rawTotal: number;
  };
  difficultyDistribution: {
    easy: number;
    medium: number;
    hard: number;
    very_hard: number;
  };
  questionTypeMix: {
    mc_single: number;
    mc_multiple: number;
    calculation: number;
    case_study: number;
    transfer: number;
  };
}

import { MAX_QUESTIONS_PER_PACKAGE } from "./exam-pool-limits.ts";

const HARD_CAP = MAX_QUESTIONS_PER_PACKAGE; // SSOT: 2000

function getBaseByDuration(months: number | null | undefined, track: string): number {
  if (track === 'EXAM_FIRST') return 1000;
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
      return 1.0;
  }
}

function getDynamicDifficulty(_target: number): HybridTargetResult['difficultyDistribution'] {
  // SSOT: Einheitliche Verteilung für alle Kurse unabhängig von Target-Größe
  return { easy: 0.10, medium: 0.45, hard: 0.35, very_hard: 0.10 };
}

function getDynamicQuestionTypeMix(mathRatio: number): HybridTargetResult['questionTypeMix'] {
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
    difficultyDistribution: getDynamicDifficulty(target),
    questionTypeMix: getDynamicQuestionTypeMix(input.mathRatio ?? 0.15),
  };
}

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
