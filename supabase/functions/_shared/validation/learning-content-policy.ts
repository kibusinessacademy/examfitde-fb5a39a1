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
}

const POLICY_VERSION = "2026-04-04-v1";

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
