/**
 * SSOT: Persona-based Learning Content Validation Policy
 *
 * v3: Persona-aware — replaces binary track-based policy with
 * 5 distinct persona profiles for validation thresholds.
 */

import { type PersonaProfile, getPersonaConfig } from "../persona-profiles.ts";

// ── Integrity Profile ──

export type IntegrityProfile =
  | "AZUBI_HIGH_ROI"
  | "AZUBI_LOW_ROI"
  | "SACHKUNDE"
  | "FACHWIRT"
  | "STUDIUM"
  // Legacy aliases
  | "AUSBILDUNG_VOLL"
  | "AUSBILDUNG_LIGHT"
  | "WEITERBILDUNG";

/**
 * Resolve the integrity profile for a package.
 * Priority: explicit persona_profile > integrity_profile > track fallback.
 */
export function resolveIntegrityProfile(pkg: {
  persona_profile?: string | null;
  integrity_profile?: string | null;
  track?: string | null;
}): IntegrityProfile {
  // Persona profile takes highest priority
  if (pkg.persona_profile) {
    const p = pkg.persona_profile.toUpperCase();
    if (["AZUBI_HIGH_ROI", "AZUBI_LOW_ROI", "SACHKUNDE", "FACHWIRT", "STUDIUM"].includes(p)) {
      return p as IntegrityProfile;
    }
  }

  // Legacy integrity_profile
  if (pkg.integrity_profile) {
    const normalized = pkg.integrity_profile.toUpperCase();
    // Map legacy values to persona profiles
    if (normalized === "AUSBILDUNG_VOLL") return "AZUBI_LOW_ROI";
    if (normalized === "AUSBILDUNG_LIGHT") return "AZUBI_LOW_ROI";
    if (normalized === "WEITERBILDUNG") return "FACHWIRT";
    if (normalized === "STUDIUM") return "STUDIUM";
  }

  // Track fallback
  switch ((pkg.track ?? "").toUpperCase()) {
    case "STUDIUM": return "STUDIUM";
    case "EXAM_FIRST": return "SACHKUNDE";
    case "EXAM_FIRST_PLUS": return "FACHWIRT";
    default: return "AZUBI_LOW_ROI";
  }
}

// ── Validation Policy ──

export interface ValidationPolicy {
  profile: IntegrityProfile;
  policyVersion: string;

  requireIhkExamStyle: boolean;
  requireOperationalContext: boolean;
  requireAcademicTerminology: boolean;
  requireTheoryModeling: boolean;
  requireConceptPrecision: boolean;

  thresholdHealthy: number;
  thresholdSoftPass: number;
  thresholdRepairable: number;

  tier2Persona: string;
  tier2Dimensions: string;

  hardFailOnMissingExamContext: boolean;

  minicheck: {
    minHigherOrderBloomPct: number;
    maxRememberBloomPct: number;
    missingTrapSeverity: "warning" | "info";
    higherOrderLevels: string[];
    coverageThreshold: number;
    minItemsPerLesson: number;
  };

  handbook: {
    requiredSections: Array<{ pattern: RegExp; label: string }>;
    contaminationTerms: string[];
    contaminationSeverity: "warning" | "info";
    minSectionLength: number;
    minProseLength: number;
  };

  blueprint: {
    minTransferVariantPct: number;
    requiredVariantTypes: string[];
  };
}

const POLICY_VERSION = "2026-04-06-v3";

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

const FACHWIRT_HANDBOOK_SECTIONS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /handlungsbereich|handlungssituation/i, label: "Handlungsbereiche" },
  { pattern: /entscheidung|maßnahme|begründung/i, label: "Entscheidungssituationen" },
  { pattern: /prüfungsfalle|typische\s+fehler/i, label: "Prüfungsfallen" },
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

    case "AZUBI_HIGH_ROI":
    case "AUSBILDUNG_VOLL":
      return {
        profile,
        policyVersion: `${POLICY_VERSION}-azubi-high`,
        requireIhkExamStyle: true,
        requireOperationalContext: true,
        requireAcademicTerminology: false,
        requireTheoryModeling: false,
        requireConceptPrecision: true,
        thresholdHealthy: 0.80,
        thresholdSoftPass: 0.70,
        thresholdRepairable: 0.55,
        tier2Persona: "Du bist ein erfahrener IHK-Prüfer und Didaktik-Experte.",
        tier2Dimensions: "Fachliche Korrektheit (25%), Didaktische Qualität (20%), Prüfungsrelevanz (15%), Sprachliche Klarheit (10%), Vollständigkeit (10%), Berufsbezug (20%)",
        hardFailOnMissingExamContext: true,
        minicheck: {
          minHigherOrderBloomPct: 0.25,
          maxRememberBloomPct: 0.35,
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

    case "AZUBI_LOW_ROI":
    case "AUSBILDUNG_LIGHT":
      return {
        profile,
        policyVersion: `${POLICY_VERSION}-azubi-low`,
        requireIhkExamStyle: true,
        requireOperationalContext: true,
        requireAcademicTerminology: false,
        requireTheoryModeling: false,
        requireConceptPrecision: false,
        thresholdHealthy: 0.72,
        thresholdSoftPass: 0.62,
        thresholdRepairable: 0.48,
        tier2Persona: "Du bist ein IHK-Prüfer mit Fokus auf Prüfungsrelevanz.",
        tier2Dimensions: "Fachliche Korrektheit (30%), Prüfungsrelevanz (25%), Sprachliche Klarheit (15%), Vollständigkeit (15%), Berufsbezug (15%)",
        hardFailOnMissingExamContext: true,
        minicheck: {
          minHigherOrderBloomPct: 0.15,
          maxRememberBloomPct: 0.50,
          missingTrapSeverity: "info",
          higherOrderLevels: ["apply", "analyze"],
          coverageThreshold: 0.85,
          minItemsPerLesson: 2,
        },
        handbook: {
          requiredSections: VOCATIONAL_HANDBOOK_SECTIONS,
          contaminationTerms: ACADEMIC_CONTAMINATION_TERMS,
          contaminationSeverity: "info",
          minSectionLength: 500,
          minProseLength: 300,
        },
        blueprint: {
          minTransferVariantPct: 0.15,
          requiredVariantTypes: ["concept"],
        },
      };

    case "SACHKUNDE":
      return {
        profile,
        policyVersion: `${POLICY_VERSION}-sachkunde`,
        requireIhkExamStyle: false,
        requireOperationalContext: false,
        requireAcademicTerminology: false,
        requireTheoryModeling: false,
        requireConceptPrecision: true,
        thresholdHealthy: 0.70,
        thresholdSoftPass: 0.58,
        thresholdRepairable: 0.42,
        tier2Persona: "Du bist ein Sachkundeprüfer mit Fokus auf Regelkonformität.",
        tier2Dimensions: "Fachliche Korrektheit (30%), §-Konformität (25%), Entscheidungsorientierung (20%), Sprachliche Klarheit (15%), Vollständigkeit (10%)",
        hardFailOnMissingExamContext: false,
        minicheck: {
          minHigherOrderBloomPct: 0.10,
          maxRememberBloomPct: 0.60,
          missingTrapSeverity: "info",
          higherOrderLevels: ["apply"],
          coverageThreshold: 0.85,
          minItemsPerLesson: 2,
        },
        handbook: {
          requiredSections: [
            { pattern: /rechtsgrundlage|§|gesetz|verordnung/i, label: "Rechtsgrundlagen" },
          ],
          contaminationTerms: [...ACADEMIC_CONTAMINATION_TERMS, ...IHK_CONTAMINATION_TERMS.filter(t => t !== "Azubi")],
          contaminationSeverity: "info",
          minSectionLength: 400,
          minProseLength: 200,
        },
        blueprint: {
          minTransferVariantPct: 0.10,
          requiredVariantTypes: ["concept"],
        },
      };

    case "FACHWIRT":
    case "WEITERBILDUNG":
      return {
        profile,
        policyVersion: `${POLICY_VERSION}-fachwirt`,
        requireIhkExamStyle: false,
        requireOperationalContext: true,
        requireAcademicTerminology: false,
        requireTheoryModeling: false,
        requireConceptPrecision: true,
        thresholdHealthy: 0.75,
        thresholdSoftPass: 0.65,
        thresholdRepairable: 0.50,
        tier2Persona: "Du bist ein IHK-Fortbildungsprüfer mit Fokus auf Handlungskompetenz.",
        tier2Dimensions: "Fachliche Korrektheit (25%), Handlungskompetenz (20%), Praxisrelevanz (20%), Sprachliche Klarheit (15%), Vollständigkeit (10%), Entscheidungsorientierung (10%)",
        hardFailOnMissingExamContext: false,
        minicheck: {
          minHigherOrderBloomPct: 0.25,
          maxRememberBloomPct: 0.35,
          missingTrapSeverity: "warning",
          higherOrderLevels: ["apply", "analyze", "evaluate"],
          coverageThreshold: 0.90,
          minItemsPerLesson: 3,
        },
        handbook: {
          requiredSections: FACHWIRT_HANDBOOK_SECTIONS,
          contaminationTerms: ACADEMIC_CONTAMINATION_TERMS,
          contaminationSeverity: "info",
          minSectionLength: 800,
          minProseLength: 500,
        },
        blueprint: {
          minTransferVariantPct: 0.25,
          requiredVariantTypes: ["concept", "procedure"],
        },
      };

    default:
      // Fallback: conservative AZUBI_LOW_ROI
      return getValidationPolicy("AZUBI_LOW_ROI");
  }
}

// ── Tier-2 prompt builder ──

export function buildTier2Prompt(
  policy: ValidationPolicy,
  professionName: string,
  isMiniCheck: boolean,
): string {
  if (isMiniCheck) {
    return `${policy.tier2Persona} Validiere diese Fragen für ${professionName}. Prüfe: Eindeutigkeit, Distraktoren-Qualität, fachliche Korrektheit, Niveaupassung. Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...]}`;
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
  persona_profile: string;
  profile_used: IntegrityProfile;
  policy_version: string;
  thresholds_applied: Record<string, number>;
  track_warnings: string[];
}

export function buildValidatorMeta(
  policy: ValidationPolicy,
  trackWarnings: string[] = [],
): PolicyValidationMeta {
  return {
    track: policy.profile,
    is_academic: policy.profile === "STUDIUM",
    persona_profile: policy.profile,
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

export function buildProfileMeta(
  profile: IntegrityProfile,
  policy: ValidationPolicy,
  pkg: { persona_profile?: string | null; integrity_profile?: string | null; track?: string | null },
): Record<string, unknown> {
  return {
    integrity_profile_resolved: profile,
    persona_profile: pkg.persona_profile || profile,
    policy_version: policy.policyVersion,
    policy_track_basis: pkg.persona_profile ? "persona_profile" : pkg.integrity_profile ? "package_profile" : "track_fallback",
  };
}
