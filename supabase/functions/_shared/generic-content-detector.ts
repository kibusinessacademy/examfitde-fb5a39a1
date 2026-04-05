/**
 * Generic Content Detector — Prompt Hardening (Option C)
 *
 * Detects AI-generated filler, generic phrases, and common language errors
 * in German educational content. Used by validators and quality gates
 * to flag content that needs manual review or re-generation.
 */

/** Common generic filler phrases that indicate low-quality AI output */
const GENERIC_PHRASES_DE = [
  "in diesem zusammenhang",
  "es ist wichtig zu beachten",
  "grundsätzlich kann man sagen",
  "zusammenfassend lässt sich sagen",
  "in der heutigen zeit",
  "spielt eine wichtige rolle",
  "ist von großer bedeutung",
  "nicht zu unterschätzen",
  "im folgenden wird erläutert",
  "abschließend lässt sich festhalten",
  "es gibt verschiedene möglichkeiten",
  "im allgemeinen kann man feststellen",
  "darüber hinaus ist zu erwähnen",
  "es sei darauf hingewiesen",
  "wie bereits erwähnt",
];

/** Common spelling/grammar errors in AI-generated German text */
const COMMON_ERRORS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bmangeldes\b/i, description: "Rechtschreibfehler: 'mangeldes' → 'mangelndes'" },
  { pattern: /\bfolgendermassen\b/i, description: "Rechtschreibfehler: 'folgendermassen' → 'folgendermaßen'" },
  { pattern: /\bausserdem\b/i, description: "Rechtschreibfehler: 'ausserdem' → 'außerdem'" },
  { pattern: /\bsogenannten?\b/i, description: "Stilistisch: 'sogenannt' ist oft Füllung" },
  { pattern: /\bdarüberhinaus\b/i, description: "Rechtschreibfehler: zusammengeschrieben" },
  { pattern: /\bdesweiteren\b/i, description: "Rechtschreibfehler: 'desweiteren' → 'des Weiteren'" },
  { pattern: /\bwiederspiegeln?\b/i, description: "Rechtschreibfehler: 'wiederspiegeln' → 'widerspiegeln'" },
  { pattern: /\bstandart\b/i, description: "Rechtschreibfehler: 'Standart' → 'Standard'" },
  { pattern: /\bvorallem\b/i, description: "Rechtschreibfehler: 'vorallem' → 'vor allem'" },
  { pattern: /\bsowiso\b/i, description: "Rechtschreibfehler: 'sowiso' → 'sowieso'" },
];

export interface GenericContentResult {
  ok: boolean;
  genericPhraseCount: number;
  genericPhrases: string[];
  spellingErrors: string[];
  genericRatio: number; // 0-1, proportion of generic vs total sentences
}

/**
 * Analyze text for generic filler content and common errors.
 * @param html Raw HTML content
 * @param maxGenericPhrases Maximum allowed generic phrases before flagging (default: 3)
 */
export function detectGenericContent(
  html: string,
  maxGenericPhrases = 3,
): GenericContentResult {
  const text = String(html ?? "");
  const lower = text.replace(/<[^>]+>/g, " ").toLowerCase();

  // Count generic phrases
  const foundPhrases: string[] = [];
  for (const phrase of GENERIC_PHRASES_DE) {
    if (lower.includes(phrase)) {
      foundPhrases.push(phrase);
    }
  }

  // Check spelling errors
  const foundErrors: string[] = [];
  for (const { pattern, description } of COMMON_ERRORS) {
    if (pattern.test(text)) {
      foundErrors.push(description);
    }
  }

  // Estimate sentence count for ratio
  const sentences = lower.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const genericRatio = sentences.length > 0
    ? foundPhrases.length / sentences.length
    : 0;

  return {
    ok: foundPhrases.length <= maxGenericPhrases && foundErrors.length === 0,
    genericPhraseCount: foundPhrases.length,
    genericPhrases: foundPhrases,
    spellingErrors: foundErrors,
    genericRatio,
  };
}

// ── Severity & Audit Layer ──

export type ContentSeverity = "info" | "warning" | "error" | "critical";

export function resolveGenericSeverity(input: {
  genericPhraseCount: number;
  spellingErrorCount: number;
  genericRatio: number;
  artifactType: string;
}): ContentSeverity {
  const { genericPhraseCount, spellingErrorCount, genericRatio, artifactType } = input;
  const handbookBoost = artifactType === "handbook_chapter" ? 1 : 0;

  if (
    genericRatio >= 0.20 ||
    genericPhraseCount >= 8 ||
    spellingErrorCount >= 4 + handbookBoost
  ) return "critical";

  if (
    genericRatio >= 0.12 ||
    genericPhraseCount >= 5 ||
    spellingErrorCount >= 2
  ) return "error";

  if (
    genericRatio >= 0.06 ||
    genericPhraseCount >= 3 ||
    spellingErrorCount >= 1
  ) return "warning";

  return "info";
}

export function isAutoRehealEligible(input: {
  artifactType: string;
  severity: ContentSeverity;
}): boolean {
  if (input.severity !== "critical" && input.severity !== "error") return false;
  return ["lesson", "handbook_chapter", "tutor_snippet"].includes(input.artifactType);
}

export interface GenericContentAuditResult extends GenericContentResult {
  severity: ContentSeverity;
  autoRehealEligible: boolean;
}

/**
 * Full audit wrapper: detects generic content + resolves severity + reheal eligibility.
 */
export function auditGenericContent(
  html: string,
  artifactType: string,
): GenericContentAuditResult {
  const base = detectGenericContent(html);
  const severity = resolveGenericSeverity({
    genericPhraseCount: base.genericPhraseCount,
    spellingErrorCount: base.spellingErrors.length,
    genericRatio: base.genericRatio,
    artifactType,
  });

  return {
    ...base,
    severity,
    autoRehealEligible: isAutoRehealEligible({ artifactType, severity }),
  };
}
