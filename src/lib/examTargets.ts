/**
 * Dynamic Exam Targets — gekoppelt an Ausbildungsdauer
 * 
 * Logik:
 *   24 Monate → 600 Fragen (Ship: 500)
 *   30 Monate → 800 Fragen (Ship: 700)
 *   36 Monate → 1000 Fragen (Ship: 850)
 *   EXAM_FIRST → 1200 (Ship: 1000)
 */

export interface ExamTargetConfig {
  /** Vollständiges Ziel */
  target: number;
  /** Mindestanzahl für Ship-Readiness */
  shipTarget: number;
  /** Label für Produktbeschreibungen */
  label: string;
  /** Kurzbeschreibung für Marketing */
  marketingLabel: string;
}

export function getExamTarget(
  durationMonths: number | null | undefined,
  track: string = 'AUSBILDUNG_VOLL',
): ExamTargetConfig {
  if (track === 'EXAM_FIRST' || track === 'EXAM_FIRST_PLUS') {
    return {
      target: 1200,
      shipTarget: 1000,
      label: '1.200+',
      marketingLabel: 'über 1.200 Prüfungsfragen',
    };
  }

  const months = durationMonths ?? 36;

  if (months <= 24) {
    return {
      target: 600,
      shipTarget: 500,
      label: '600+',
      marketingLabel: 'über 600 Prüfungsfragen',
    };
  }

  if (months <= 30) {
    return {
      target: 800,
      shipTarget: 700,
      label: '800+',
      marketingLabel: 'über 800 Prüfungsfragen',
    };
  }

  // 36+ Monate
  return {
    target: 1000,
    shipTarget: 850,
    label: '1.000+',
    marketingLabel: 'über 1.000 Prüfungsfragen',
  };
}

/**
 * Deno-kompatible Version für Edge Functions (kein React-Import)
 */
export function getExamTargetForPipeline(
  durationMonths: number | null | undefined,
  track: string = 'AUSBILDUNG_VOLL',
): { target: number; shipTarget: number } {
  const config = getExamTarget(durationMonths, track);
  return { target: config.target, shipTarget: config.shipTarget };
}
