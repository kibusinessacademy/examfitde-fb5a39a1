/**
 * Bloom Taxonomy Distribution per Certification Level
 * 
 * Controls cognitive complexity of generated questions:
 * - Ausbildung: Heavy on Apply (hands-on knowledge)
 * - Fachwirt: Shifts toward Analyze
 * - Meister: Evaluate-heavy (strategic assessment)
 * - Betriebswirt: Create + Evaluate (executive decisions)
 * - Sachkunde: Remember + Apply (regulatory knowledge)
 */

export interface BloomDistribution {
  remember: number;
  understand: number;
  apply: number;
  analyze: number;
  evaluate: number;
  create: number;
}

export type CertificationLevel =
  | 'ausbildung'
  | 'fachwirt'
  | 'meister'
  | 'betriebswirt'
  | 'sachkunde'
  | 'aevo'
  | 'projektmanagement';

const BLOOM_DEFAULTS: Record<CertificationLevel, BloomDistribution> = {
  ausbildung: {
    remember: 0.10,
    understand: 0.20,
    apply: 0.40,
    analyze: 0.20,
    evaluate: 0.08,
    create: 0.02,
  },
  fachwirt: {
    remember: 0.05,
    understand: 0.10,
    apply: 0.25,
    analyze: 0.35,
    evaluate: 0.20,
    create: 0.05,
  },
  meister: {
    remember: 0.03,
    understand: 0.07,
    apply: 0.20,
    analyze: 0.30,
    evaluate: 0.30,
    create: 0.10,
  },
  betriebswirt: {
    remember: 0.02,
    understand: 0.05,
    apply: 0.15,
    analyze: 0.28,
    evaluate: 0.35,
    create: 0.15,
  },
  sachkunde: {
    remember: 0.15,
    understand: 0.25,
    apply: 0.35,
    analyze: 0.15,
    evaluate: 0.08,
    create: 0.02,
  },
  aevo: {
    remember: 0.10,
    understand: 0.15,
    apply: 0.30,
    analyze: 0.25,
    evaluate: 0.15,
    create: 0.05,
  },
  projektmanagement: {
    remember: 0.05,
    understand: 0.10,
    apply: 0.25,
    analyze: 0.30,
    evaluate: 0.25,
    create: 0.05,
  },
};

/**
 * Get Bloom distribution for a certification level.
 * Falls back to 'ausbildung' for unknown levels.
 * Accepts optional override from DB (certification_catalog.bloom_distribution).
 */
export function getBloomDistribution(
  level: string | null | undefined,
  dbOverride?: Partial<BloomDistribution> | null,
): BloomDistribution {
  const base = BLOOM_DEFAULTS[(level as CertificationLevel) ?? 'ausbildung']
    ?? BLOOM_DEFAULTS.ausbildung;

  if (!dbOverride) return base;

  // Merge DB override, re-normalize to sum = 1.0
  const merged = { ...base, ...dbOverride };
  const total = Object.values(merged).reduce((s, v) => s + v, 0);
  if (total === 0) return base;

  return {
    remember: merged.remember / total,
    understand: merged.understand / total,
    apply: merged.apply / total,
    analyze: merged.analyze / total,
    evaluate: merged.evaluate / total,
    create: merged.create / total,
  };
}

/** Human-readable labels for German UI */
export const BLOOM_LABELS: Record<keyof BloomDistribution, string> = {
  remember: 'Erinnern',
  understand: 'Verstehen',
  apply: 'Anwenden',
  analyze: 'Analysieren',
  evaluate: 'Bewerten',
  create: 'Erschaffen',
};

/** Level labels for UI */
export const LEVEL_LABELS: Record<CertificationLevel, string> = {
  ausbildung: 'Ausbildung',
  fachwirt: 'Fachwirt',
  meister: 'Meister',
  betriebswirt: 'Betriebswirt',
  sachkunde: 'Sachkunde',
  aevo: 'AEVO',
  projektmanagement: 'Projektmanagement',
};

/** DQR levels for display */
export const LEVEL_DQR: Record<CertificationLevel, string> = {
  ausbildung: 'DQR 3–4',
  fachwirt: 'DQR 6',
  meister: 'DQR 6',
  betriebswirt: 'DQR 7',
  sachkunde: 'DQR 3–4',
  aevo: 'DQR 6',
  projektmanagement: 'DQR 5–6',
};
