/**
 * SSOT: Deterministic Lesson Content Quality Assessment
 *
 * Works with the existing HTML-based tool-calling output format.
 * Used by generate-learning-content to enforce minimum depth before
 * marking content as valid, and to drive expand-retry loops.
 *
 * This does NOT replace the v2 quality gate (hallucination/depth scoring) —
 * it adds a deterministic structural check that drives auto-expand retries.
 */

export interface LessonQualityResult {
  ok: boolean;
  reasons: string[];
  charCount: number;
  wordCount: number;
  hasRequiredStructure: boolean;
  hasList: boolean;
  hasExamTip: boolean;
  hasExamTrap: boolean;
}

export interface StepQualityThresholds {
  minChars: number;
  minWords: number;
  requireExamTip: boolean;
  requireExamTrap: boolean;
  requireList: boolean;
}

/**
 * Per-step quality thresholds — TWO-PHASE ARCHITECTURE:
 *
 * Phase 1 (Build/Lean): Low thresholds to keep pipeline fast.
 *   Content must be structurally complete but not deeply expanded.
 *   Expansion happens later in elite_harden (Phase 2).
 *
 * These are the HARD minimums; content below these triggers expand-retry.
 */
const STEP_THRESHOLDS: Record<string, StepQualityThresholds> = {
  einstieg: {
    minChars: 400,
    minWords: 120,
    requireExamTip: false,
    requireExamTrap: false,
    requireList: false,
  },
  verstehen: {
    minChars: 600,
    minWords: 150,
    requireExamTip: false,
    requireExamTrap: false,
    requireList: true,
  },
  anwenden: {
    minChars: 500,
    minWords: 130,
    requireExamTip: false,
    requireExamTrap: false,
    requireList: false,
  },
  wiederholen: {
    minChars: 400,
    minWords: 100,
    requireExamTip: false,
    requireExamTrap: false,
    requireList: false,
  },
};

const DEFAULT_THRESHOLDS: StepQualityThresholds = {
  minChars: 500,
  minWords: 120,
  requireExamTip: false,
  requireExamTrap: false,
  requireList: false,
};

/**
 * Phase 2 (Elite Expansion) thresholds — used by elite_harden step.
 * These are the FULL Elite-quality requirements.
 */
export const ELITE_STEP_THRESHOLDS: Record<string, StepQualityThresholds> = {
  einstieg: {
    minChars: 600,
    minWords: 250,
    requireExamTip: true,
    requireExamTrap: false,
    requireList: true,
  },
  verstehen: {
    minChars: 1800,
    minWords: 400,
    requireExamTip: true,
    requireExamTrap: true,
    requireList: true,
  },
  anwenden: {
    minChars: 1400,
    minWords: 350,
    requireExamTip: true,
    requireExamTrap: true,
    requireList: true,
  },
  wiederholen: {
    minChars: 1200,
    minWords: 300,
    requireExamTip: false,
    requireExamTrap: true,
    requireList: true,
  },
};

export const ELITE_DEFAULT_THRESHOLDS: StepQualityThresholds = {
  minChars: 1400,
  minWords: 300,
  requireExamTip: true,
  requireExamTrap: true,
  requireList: true,
};

/**
 * Assess whether a lesson's HTML content meets the deterministic quality bar.
 * Returns structured result with specific failure reasons for expand prompts.
 */
export function assessLessonQuality(
  html: string,
  step: string,
  thresholdsOverride?: Partial<StepQualityThresholds>,
): LessonQualityResult {
  const text = String(html ?? "");
  const thresholds = { ...(STEP_THRESHOLDS[step] || DEFAULT_THRESHOLDS), ...thresholdsOverride };

  const charCount = text.length;
  // Strip HTML tags for word count
  const plainText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = plainText ? plainText.split(/\s+/).length : 0;

  // Structural checks — look for substantive HTML elements
  const hasHeading = /<h[2-4][^>]*>/i.test(text);
  const hasMultipleParagraphs = (text.match(/<p[^>]*>/gi) || []).length >= 2;
  const hasRequiredStructure = hasHeading && hasMultipleParagraphs;

  // List check (ordered or unordered)
  const hasList = /<[ou]l[^>]*>/i.test(text) || /\n-\s+/.test(text) || /\n\d+\.\s+/.test(text);

  // Exam elements
  const hasExamTip = /⭐|IHK-Prüfungstipp|Prüfungstipp/i.test(text);
  const hasExamTrap = /⚠️|Prüfungsfalle|Typische Falle/i.test(text);

  // Placeholder/TODO detection
  const hasPlaceholder = /_placeholder/i.test(text) || /\bTODO\b/i.test(text) || /Platzhalter/i.test(text);

  const reasons: string[] = [];

  if (charCount < thresholds.minChars) {
    reasons.push(`too_short(${charCount}<${thresholds.minChars})`);
  }
  if (wordCount < thresholds.minWords) {
    reasons.push(`too_few_words(${wordCount}<${thresholds.minWords})`);
  }
  if (!hasRequiredStructure) {
    reasons.push("missing_structure(need_heading+paragraphs)");
  }
  if (thresholds.requireList && !hasList) {
    reasons.push("missing_list");
  }
  if (thresholds.requireExamTip && !hasExamTip) {
    reasons.push("missing_exam_tip");
  }
  if (thresholds.requireExamTrap && !hasExamTrap) {
    reasons.push("missing_exam_trap");
  }
  if (hasPlaceholder) {
    reasons.push("contains_placeholder");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    charCount,
    wordCount,
    hasRequiredStructure,
    hasList,
    hasExamTip,
    hasExamTrap,
  };
}

/**
 * Build an expand prompt that instructs the LLM to enrich existing content
 * WITHOUT changing the topic. Returns system + user messages for tool-calling.
 */
export function buildExpandSystemPrompt(args: {
  professionName: string;
  lessonTitle: string;
  step: string;
  missingReasons: string[];
  thresholds: StepQualityThresholds;
}): string {
  const { professionName, lessonTitle, step, missingReasons, thresholds } = args;

  const reasonsBlock = missingReasons.map(r => `- ${r}`).join("\n");

  return `Du bist ein erfahrener IHK-Fachexperte für ${professionName}.

AUFGABE: Der bestehende Lerninhalt für "${lessonTitle}" (Schritt: ${step}) ist noch nicht ausreichend.
Erweitere und verbessere den Inhalt, OHNE das Thema zu wechseln oder neue Konzepte einzuführen.

QUALITÄTSMÄNGEL die behoben werden müssen:
${reasonsBlock}

HARTE ANFORDERUNGEN:
- Mindestens ${thresholds.minChars} Zeichen HTML-Inhalt
- Mindestens ${thresholds.minWords} Wörter Fließtext
${thresholds.requireExamTip ? '- Mindestens ein ⭐ IHK-Prüfungstipp' : ''}
${thresholds.requireExamTrap ? '- Mindestens eine ⚠️ Prüfungsfalle mit Erklärung' : ''}
${thresholds.requireList ? '- Mindestens eine Liste (<ul>/<ol>)' : ''}
- Klare Überschriften (<h3>), substantielle Absätze (<p>)
- Keine Platzhalter, kein TODO, kein generischer Fülltext
- Deutsche Sprache, IHK-Prüfungsniveau

WICHTIG: Erweitere den bestehenden Inhalt. Ersetze ihn NICHT komplett.
Gib den vollständig erweiterten Inhalt über die bereitgestellte Funktion zurück.`;
}

/**
 * Get Phase 1 (lean build) thresholds for a given step type.
 */
export function getStepThresholds(step: string): StepQualityThresholds {
  return STEP_THRESHOLDS[step] || DEFAULT_THRESHOLDS;
}

/**
 * Get Phase 2 (elite expansion) thresholds for a given step type.
 */
export function getEliteStepThresholds(step: string): StepQualityThresholds {
  return ELITE_STEP_THRESHOLDS[step] || ELITE_DEFAULT_THRESHOLDS;
}
