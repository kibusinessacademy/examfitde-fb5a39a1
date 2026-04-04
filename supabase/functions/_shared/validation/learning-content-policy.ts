/**
 * SSOT: Profile-based Learning Content Validation Policy
 *
 * Ensures that STUDIUM packages are validated with academic criteria,
 * not IHK/vocational rules. The policy layer decouples validation logic
 * from hard-coded track assumptions.
 */

// ── Integrity Profile ──

export type IntegrityProfile =
  | "AUSBILDUNG_VOLL"
  | "AUSBILDUNG_LIGHT"
  | "STUDIUM"
  | "WEITERBILDUNG";

/**
 * Resolve the integrity profile for a package.
 * Priority: explicit integrity_profile > track fallback > conservative default.
 */
export function resolveIntegrityProfile(pkg: {
  integrity_profile?: string | null;
  track?: string | null;
}): IntegrityProfile {
  if (pkg.integrity_profile) {
    const normalized = pkg.integrity_profile.toUpperCase();
    if (["AUSBILDUNG_VOLL", "AUSBILDUNG_LIGHT", "STUDIUM", "WEITERBILDUNG"].includes(normalized)) {
      return normalized as IntegrityProfile;
    }
  }

  switch ((pkg.track ?? "").toUpperCase()) {
    case "STUDIUM":
      return "STUDIUM";
    case "WEITERBILDUNG":
      return "WEITERBILDUNG";
    default:
      return "AUSBILDUNG_VOLL";
  }
}

// ── Validation Policy ──

export interface ValidationPolicy {
  profile: IntegrityProfile;
  policyVersion: string;

  // What to require / skip
  requireIhkExamStyle: boolean;
  requireOperationalContext: boolean;
  requireAcademicTerminology: boolean;
  requireTheoryModeling: boolean;
  requireConceptPrecision: boolean;

  // Gate thresholds (override learning-content-gate defaults)
  thresholdHealthy: number;
  thresholdSoftPass: number;
  thresholdRepairable: number;

  // Tier-2 LLM prompt persona
  tier2Persona: string;
  tier2Dimensions: string;

  // Hard-fail flags
  hardFailOnMissingExamContext: boolean;

  // ── MiniCheck rules ──
  minicheck: {
    /** Minimum fraction of higher-order Bloom levels (apply/analyze/evaluate/create) */
    minHigherOrderBloomPct: number;
    /** Maximum fraction of pure-recall Bloom levels (remember) */
    maxRememberBloomPct: number;
    /** Severity for missing trap_tags: "warning" | "info" */
    missingTrapSeverity: "warning" | "info";
    /** Bloom levels considered "higher order" */
    higherOrderLevels: string[];
    /** Coverage threshold for publish gate */
    coverageThreshold: number;
    /** Min approved items per lesson */
    minItemsPerLesson: number;
  };

  // ── Handbook rules ──
  handbook: {
    /** Required structural sections (regex patterns) */
    requiredSections: Array<{ pattern: RegExp; label: string }>;
    /** Contamination terms to detect (opposite-track terms) */
    contaminationTerms: string[];
    /** Contamination severity */
    contaminationSeverity: "warning" | "info";
    /** Min section length (chars) for basis validation */
    minSectionLength: number;
    /** Min prose length (chars) */
    minProseLength: number;
  };

  // ── Blueprint rules ──
  blueprint: {
    /** Min fraction of transfer/application variants */
    minTransferVariantPct: number;
    /** Required variant types */
    requiredVariantTypes: string[];
  };
}

const POLICY_VERSION = "2026-04-04-v2";

// ── Shared constants ──
const IHK_CONTAMINATION_TERMS = [
  "Berichtsheft", "Azubi", "Ausbildungsrahmenplan", "Ausbildungsbetrieb",
  "Ausbildungsordnung", "Zwischenprüfung", "Gesellenprüfung",
  "Ausbildungsnachweis", "überbetriebliche Unterweisung",
];

const ACADEMIC_CONTAMINATION_TERMS = [
  "Seminararbeit", "Studienordnung", "Modulhandbuch", "Klausurzulassung",
  "Bachelorarbeit", "Masterarbeit", "ECTS",
];

const ACADEMIC_HANDBOOK_SECTIONS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /modellvergleich|theorievergleich|gegenüberstellung/i, label: "Modellvergleich" },
  { pattern: /transfer|anwendung|fallbeispiel|praxisbezug/i, label: "Transfer/Anwendung" },
  { pattern: /theor(ie|etisch)|framework|modell|konzept/i, label: "Theoretische Grundlagen" },
];

const VOCATIONAL_HANDBOOK_SECTIONS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /prüfungsfalle|typische\s+fehler|häufige\s+fehler/i, label: "Prüfungsfallen" },
  { pattern: /merkschema|eselsbrücke|checkliste|merkhilfe/i, label: "Merkschemata" },
  { pattern: /formel|berechnung|kalkulation/i, label: "Formeln & Berechnungen" },
];

// ── Policy definitions ──

export function getValidationPolicy(profile: IntegrityProfile): ValidationPolicy {
  switch (profile) {
    case "STUDIUM":
      return {
        profile,
        policyVersion: `${POLICY_VERSION}-studium`,

        requireIhkExamStyle: false,
        requireOperationalContext: false,
        requireAcademicTerminology: true,
        requireTheoryModeling: true,
        requireConceptPrecision: true,

        thresholdHealthy: 0.65,
        thresholdSoftPass: 0.55,
        thresholdRepairable: 0.40,

        tier2Persona: "Du bist Hochschuldozent und Klausur-Experte.",
        tier2Dimensions: "Fachliche Korrektheit (25%), Akademische Tiefe & Terminologie (20%), Theorie-Modell-Bezug (15%), Begriffspräzision (15%), Didaktische Klarheit (15%), Strukturelle Vollständigkeit (10%)",

        hardFailOnMissingExamContext: false,

        minicheck: {
          minHigherOrderBloomPct: 0.30,
          maxRememberBloomPct: 0.30,
          missingTrapSeverity: "info",
          higherOrderLevels: ["apply", "analyze", "evaluate", "create"],
          coverageThreshold: 0.90,
          minItemsPerLesson: 3,
        },

        handbook: {
          requiredSections: ACADEMIC_HANDBOOK_SECTIONS,
          contaminationTerms: IHK_CONTAMINATION_TERMS,
          contaminationSeverity: "warning",
          minSectionLength: 800,
          minProseLength: 500,
        },

        blueprint: {
          minTransferVariantPct: 0.34,
          requiredVariantTypes: ["concept", "transfer", "analysis"],
        },
      };

    case "WEITERBILDUNG":
      return {
        profile,
        policyVersion: `${POLICY_VERSION}-weiterbildung`,

        requireIhkExamStyle: false,
        requireOperationalContext: true,
        requireAcademicTerminology: false,
        requireTheoryModeling: false,
        requireConceptPrecision: true,

        thresholdHealthy: 0.72,
        thresholdSoftPass: 0.62,
        thresholdRepairable: 0.48,

        tier2Persona: "Du bist Experte für berufliche Weiterbildung.",
        tier2Dimensions: "Fachliche Korrektheit (25%), Praxisrelevanz (20%), Handlungskompetenz (15%), Sprachliche Klarheit (15%), Vollständigkeit (15%), Berufsbezug (10%)",

        hardFailOnMissingExamContext: false,

        minicheck: {
          minHigherOrderBloomPct: 0.20,
          maxRememberBloomPct: 0.40,
          missingTrapSeverity: "warning",
          higherOrderLevels: ["apply", "analyze", "evaluate"],
          coverageThreshold: 0.90,
          minItemsPerLesson: 3,
        },

        handbook: {
          requiredSections: VOCATIONAL_HANDBOOK_SECTIONS,
          contaminationTerms: ACADEMIC_CONTAMINATION_TERMS,
          contaminationSeverity: "info",
          minSectionLength: 800,
          minProseLength: 500,
        },

        blueprint: {
          minTransferVariantPct: 0.20,
          requiredVariantTypes: ["concept", "procedure"],
        },
      };

    default: // AUSBILDUNG_VOLL, AUSBILDUNG_LIGHT
      return {
        profile,
        policyVersion: `${POLICY_VERSION}-ausbildung`,

        requireIhkExamStyle: true,
        requireOperationalContext: true,
        requireAcademicTerminology: false,
        requireTheoryModeling: false,
        requireConceptPrecision: true,

        thresholdHealthy: 0.80,
        thresholdSoftPass: 0.70,
        thresholdRepairable: 0.55,

        tier2Persona: "Du bist ein IHK-Prüfer und Didaktik-Experte.",
        tier2Dimensions: "Fachliche Korrektheit (25%), Didaktische Qualität (20%), Prüfungsrelevanz (15%), Sprachliche Klarheit (10%), Vollständigkeit (10%), Berufsbezug (20%)",

        hardFailOnMissingExamContext: true,

        minicheck: {
          minHigherOrderBloomPct: 0.20,
          maxRememberBloomPct: 0.40,
          missingTrapSeverity: "warning",
          higherOrderLevels: ["apply", "analyze", "evaluate"],
          coverageThreshold: 0.90,
          minItemsPerLesson: 3,
        },

        handbook: {
          requiredSections: VOCATIONAL_HANDBOOK_SECTIONS,
          contaminationTerms: ACADEMIC_CONTAMINATION_TERMS,
          contaminationSeverity: "info",
          minSectionLength: 800,
          minProseLength: 500,
        },

        blueprint: {
          minTransferVariantPct: 0.20,
          requiredVariantTypes: ["concept", "procedure"],
        },
      };
  }
}

// ── Tier-2 prompt builder ──

export function buildTier2Prompt(
  policy: ValidationPolicy,
  professionName: string,
  isMiniCheck: boolean,
): string {
  if (isMiniCheck) {
    const persona = policy.profile === "STUDIUM"
      ? `Du bist Hochschuldozent. Validiere diese Verständnisfragen für das Fach "${professionName}".`
      : `Du bist ein IHK-Prüfungsexperte. Validiere diese Mini-Check-Fragen für ${professionName}.`;

    const criteria = policy.profile === "STUDIUM"
      ? "Prüfe: Eindeutigkeit, Distraktoren-Qualität, fachliche Korrektheit, akademisches Niveau."
      : "Prüfe: Eindeutigkeit, Distraktoren-Qualität, IHK-Konformität, Berufsbezug.";

    return `${persona} ${criteria} Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...]}`;
  }

  return `${policy.tier2Persona} Bewerte den Lerninhalt für "${professionName}" nach: ${policy.tier2Dimensions}. Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...]}`;
}

// ── Profile-aware reason codes ──

export type StudiumReasonCode =
  | "ACADEMIC_TERMINOLOGY_TOO_WEAK"
  | "THEORY_MODEL_LINK_MISSING"
  | "CONCEPT_PRECISION_TOO_LOW"
  | "ACADEMIC_DEPTH_TOO_LOW"
  | "ANALYTICAL_EXPLANATION_TOO_WEAK";

// ── Structured validator output ──

export interface PolicyValidationMeta {
  track: string;
  is_academic: boolean;
  profile_used: IntegrityProfile;
  policy_version: string;
  thresholds_applied: Record<string, number>;
  track_warnings: string[];
}

/**
 * Build structured meta for validator outputs.
 * This enables the Control Tower to display why a course soft-failed per track.
 */
export function buildValidatorMeta(
  policy: ValidationPolicy,
  trackWarnings: string[] = [],
): PolicyValidationMeta {
  return {
    track: policy.profile,
    is_academic: policy.profile === "STUDIUM",
    profile_used: policy.profile,
    policy_version: policy.policyVersion,
    thresholds_applied: {
      healthy: policy.thresholdHealthy,
      soft_pass: policy.thresholdSoftPass,
      repairable: policy.thresholdRepairable,
      minicheck_higher_order_bloom_pct: policy.minicheck.minHigherOrderBloomPct,
      minicheck_max_remember_pct: policy.minicheck.maxRememberBloomPct,
      minicheck_coverage: policy.minicheck.coverageThreshold,
      blueprint_transfer_variant_pct: policy.blueprint.minTransferVariantPct,
    },
    track_warnings: trackWarnings,
  };
}

/**
 * Build profile-specific meta for step persistence.
 */
export function buildProfileMeta(
  profile: IntegrityProfile,
  policy: ValidationPolicy,
  pkg: { integrity_profile?: string | null; track?: string | null },
): Record<string, unknown> {
  return {
    integrity_profile_resolved: profile,
    policy_version: policy.policyVersion,
    policy_track_basis: pkg.integrity_profile ? "package_profile" : "track_fallback",
  };
}
