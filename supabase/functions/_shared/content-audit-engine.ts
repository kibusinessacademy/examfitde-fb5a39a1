/**
 * Content Audit Engine — SSOT (v3 hardened)
 *
 * Core audit logic that applies track-aware profiles to any artifact.
 * Layers:
 *   A — Structural Integrity (hard governance)
 *   B — Exam & Content Quality
 *   C — Language Quality (generic phrases, spelling, sentence length)
 *   D — Didactic Quality
 *   E — Context & Tutor Quality
 *
 * generic_score is a composite from B+C+D+E (not just language).
 */

import { getAuditProfile, type AuditProfile, type TrackKey } from "./audit-profiles.ts";
import type { AuditFlag, AuditSeverity, AuditStatus, ContentAuditResult } from "./content-audit-types.ts";
import { detectGenericContent } from "./generic-content-detector.ts";

// ── Input ──

export type AuditInput = {
  track: string;
  artifact_type: string;
  artifact_id?: string | null;

  // Structural refs
  curriculum_id?: string | null;
  blueprint_id?: string | null;
  competency_id?: string | null;
  lesson_id?: string | null;
  learning_field_id?: string | null;
  exam_type?: string | null;
  difficulty?: string | null;
  weight_percentage?: number | null;

  // Tutor context
  tutor_mode?: string | null;
  exam_session_id?: string | null;

  // Content
  title?: string | null;
  content?: string | null;

  meta?: Record<string, unknown> | null;
};

// ── Artifact-specific content length thresholds ──

const MIN_CONTENT_LENGTH: Record<string, { critical: number; error: number }> = {
  lesson:            { critical: 20,  error: 150 },
  handbook_chapter:  { critical: 20,  error: 150 },
  exam_question:     { critical: 10,  error: 30 },
  minicheck_question:{ critical: 10,  error: 30 },
  oral_exam_question:{ critical: 10,  error: 50 },
  tutor_response:    { critical: 10,  error: 50 },
  seo_article:       { critical: 20,  error: 200 },
};

// ── Main Entry Point ──

export function runContentAudit(input: AuditInput): ContentAuditResult {
  const profile = getAuditProfile(input.track);
  const flags: AuditFlag[] = [];
  const content = String(input.content ?? "");
  const plainText = content.replace(/<[^>]+>/g, " ").trim();

  // ─── Layer A — Structural Integrity (HARD) ───
  pushStructuralFlags(flags, input, profile, plainText);

  const hasHardStructuralFailure = flags.some(
    (f) => f.layer === "A" && f.severity === "critical",
  );

  if (hasHardStructuralFailure) {
    return {
      ok: false,
      audit_status: "rejected",
      generic_score: 100,
      didactic_score: null,
      flags,
      track: profile.track,
      artifact_type: input.artifact_type,
      artifact_id: input.artifact_id ?? null,
    };
  }

  // ─── Layer B — Exam & Content Quality ───
  const scoreB = pushExamQualityFlags(flags, input, profile);

  // ─── Layer C — Language Quality ───
  const scoreC = pushLanguageFlags(flags, content, input, profile);

  // ─── Layer D — Didactic Quality ───
  const { score: didacticScore, penalty: scoreD } = pushDidacticFlags(flags, input, profile, plainText);

  // ─── Layer E — Context & Tutor Quality ───
  const scoreE = pushContextFlags(flags, input, profile);

  // ─── Composite generic_score from B+C+D+E ───
  const genericScore = Math.min(100, Math.round(scoreB + scoreC + scoreD + scoreE));

  // ─── Resolve final status (score + hard rules) ───
  const auditStatus = resolveAuditStatus(flags, genericScore, profile);

  return {
    ok: auditStatus === "approved" || auditStatus === "review",
    audit_status: auditStatus,
    generic_score: genericScore,
    didactic_score: didacticScore,
    flags,
    track: profile.track,
    artifact_type: input.artifact_type,
    artifact_id: input.artifact_id ?? null,
  };
}

// ══════════════════════════════════════════════════
// Layer A: Structural Integrity (HARD governance)
// ══════════════════════════════════════════════════

function pushStructuralFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
  plainText: string,
) {
  const s = profile.structural;
  const at = input.artifact_type;
  const isQuestion = ["exam_question", "minicheck_question"].includes(at);
  const isLesson = at === "lesson";
  const isLearningContent = ["lesson", "handbook_chapter"].includes(at);
  const isTutor = at === "tutor_response";

  // ── Curriculum: CRITICAL for all ──
  if (s.requireCurriculum && !input.curriculum_id) {
    flags.push({ layer: "A", code: "MISSING_CURRICULUM", severity: "critical", field: "curriculum_id", message: "Curriculum-Referenz fehlt" });
  }

  // ── Competency: CRITICAL for learning-relevant content ──
  if (s.requireCompetency && !input.competency_id && (isLearningContent || isQuestion)) {
    flags.push({ layer: "A", code: "MISSING_COMPETENCY", severity: "critical", field: "competency_id", message: "Kompetenz-Referenz fehlt" });
  }

  // ── Blueprint: CRITICAL for questions ──
  if (s.requireBlueprintForQuestions && isQuestion && !input.blueprint_id) {
    flags.push({ layer: "A", code: "MISSING_BLUEPRINT", severity: "critical", field: "blueprint_id", message: "Blueprint-Referenz fehlt für Prüfungsfrage" });
  }

  // ── Blueprint for lessons: error (not warning) ──
  if (s.requireBlueprintForLessons && isLesson && !input.blueprint_id) {
    flags.push({ layer: "A", code: "MISSING_LESSON_BLUEPRINT", severity: "error", field: "blueprint_id", message: "Lesson ohne Blueprint-Referenz" });
  }

  // ── Learning field: error ──
  if (s.requireLessonToLearningField && isLesson && !input.learning_field_id) {
    flags.push({ layer: "A", code: "MISSING_LEARNING_FIELD", severity: "error", field: "learning_field_id", message: "Lektion ohne Lernfeld-Zuordnung" });
  }

  // ── Exam type tag: error for questions ──
  if (s.requireExamTypeTag && isQuestion && !input.exam_type) {
    flags.push({ layer: "A", code: "MISSING_EXAM_TYPE", severity: "error", field: "exam_type", message: "Prüfungstyp-Tag fehlt" });
  }

  // ── Difficulty: warning for questions ──
  if (s.requireDifficulty && isQuestion && !input.difficulty) {
    flags.push({ layer: "A", code: "MISSING_DIFFICULTY", severity: "warning", field: "difficulty", message: "Schwierigkeitsgrad fehlt" });
  }

  // ── Weight: info for questions ──
  if (s.requireWeightPercentage && isQuestion && input.weight_percentage == null) {
    flags.push({ layer: "A", code: "MISSING_WEIGHT", severity: "info", field: "weight_percentage", message: "Gewichtung fehlt" });
  }

  // ── Tutor reference object: CRITICAL ──
  if (s.requireTutorReferenceObject && isTutor && !input.curriculum_id) {
    flags.push({ layer: "A", code: "TUTOR_MISSING_REFERENCE", severity: "critical", field: "curriculum_id", message: "Tutor-Antwort ohne Referenzobjekt" });
  }

  // ── Content length: artifact-type-specific thresholds ──
  const thresholds = MIN_CONTENT_LENGTH[at] ?? { critical: 20, error: 80 };
  const textLen = plainText.length;

  if (textLen < thresholds.critical) {
    flags.push({ layer: "A", code: "CONTENT_TOO_SHORT", severity: "critical", field: "content", message: `Inhalt fehlt oder zu kurz (${textLen} < ${thresholds.critical} Zeichen)` });
  } else if (textLen < thresholds.error) {
    flags.push({ layer: "A", code: "CONTENT_BELOW_MINIMUM", severity: "error", field: "content", message: `Inhalt unter Mindestschwelle (${textLen} < ${thresholds.error} Zeichen)` });
  }
}

// ══════════════════════════════════════════════════
// Layer B: Exam & Content Quality (returns penalty score 0–30)
// ══════════════════════════════════════════════════

function pushExamQualityFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
): number {
  const eq = profile.examQuality;
  const at = input.artifact_type;
  const isQuestion = ["exam_question", "minicheck_question"].includes(at);
  let penalty = 0;

  if (!isQuestion) return penalty;

  const text = String(input.content ?? "").toLowerCase();

  // ── Operator signal ──
  if (eq.requireOperatorSignal) {
    const hasOperator = profile.language.operatorSet.some((op) =>
      text.includes(op.toLowerCase())
    );
    if (!hasOperator) {
      penalty += 10;
      flags.push({
        layer: "B", code: "MISSING_OPERATOR", severity: "warning",
        message: `Kein Operator-Signal gefunden (erwartet: ${profile.language.operatorSet.slice(0, 4).join(", ")}…)`,
        suggestion: "Frage sollte mindestens einen fachlichen Operator enthalten",
      });
    }
  }

  // ── Open question format check ──
  if (!eq.allowOpenQuestions) {
    const openSignals = /\b(erörtern sie|beschreiben sie ausführlich|nehmen sie stellung|erläutern sie)\b/i;
    if (openSignals.test(text)) {
      penalty += 10;
      flags.push({
        layer: "B", code: "OPEN_QUESTION_NOT_ALLOWED", severity: "error",
        message: "Offene Frageform erkannt, aber im Track nicht erlaubt",
        suggestion: "In geschlossene MC-Frage umwandeln",
      });
    }
  }

  // ── Pure definition / knowledge question heuristic ──
  const definitionSignals = /\b(was ist|was versteht man|was bedeutet|definieren sie|wie lautet die definition)\b/i;
  if (definitionSignals.test(text)) {
    penalty += 5;
    flags.push({
      layer: "B", code: "PURE_KNOWLEDGE_QUESTION", severity: "info",
      message: "Reine Wissens-/Definitionsfrage erkannt",
      suggestion: "Transfer- oder Anwendungsbezug herstellen",
    });
  }

  return penalty;
}

// ══════════════════════════════════════════════════
// Layer C: Language Quality (returns penalty score 0–40)
// ══════════════════════════════════════════════════

function pushLanguageFlags(
  flags: AuditFlag[],
  content: string,
  input: AuditInput,
  profile: AuditProfile,
): number {
  const lang = profile.language;
  let penalty = 0;

  // Generic content detection
  if (lang.enableGenericPhraseDetection || lang.enableSpellingChecks) {
    const detection = detectGenericContent(content);

    if (lang.enableGenericPhraseDetection && detection.genericPhraseCount > 0) {
      const sev: AuditSeverity =
        detection.genericRatio >= 0.20 ? "critical" :
        detection.genericRatio >= 0.12 ? "error" :
        detection.genericPhraseCount >= 3 ? "warning" : "info";

      // Penalty proportional to ratio
      penalty += Math.round(detection.genericRatio * 100);

      if (sev !== "info") {
        flags.push({
          layer: "C", code: "GENERIC_PHRASES", severity: sev,
          message: `${detection.genericPhraseCount} generische Füllphrasen erkannt (Ratio: ${(detection.genericRatio * 100).toFixed(1)}%)`,
          suggestion: "Fachspezifisch umformulieren, Prüfungsbezug herstellen",
        });
      }
    }

    if (lang.enableSpellingChecks && detection.spellingErrors.length > 0) {
      const sev: AuditSeverity = detection.spellingErrors.length >= 4 ? "critical" :
        detection.spellingErrors.length >= 2 ? "error" : "warning";

      penalty += detection.spellingErrors.length * 3;

      flags.push({
        layer: "C", code: "SPELLING_ERRORS", severity: sev,
        message: `${detection.spellingErrors.length} Rechtschreib-/Grammatikfehler: ${detection.spellingErrors.slice(0, 3).join("; ")}`,
      });
    }
  }

  // Sentence length check
  const plainText = content.replace(/<[^>]+>/g, " ");
  const sentences = plainText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length > 0) {
    const avgWordCount = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length;
    if (avgWordCount > lang.maxSentenceLength) {
      const excess = avgWordCount - lang.maxSentenceLength;
      penalty += Math.min(10, Math.round(excess));
      flags.push({
        layer: "C", code: "SENTENCE_TOO_LONG", severity: excess > 10 ? "error" : "warning",
        message: `Ø Satzlänge ${Math.round(avgWordCount)} Wörter (max: ${lang.maxSentenceLength})`,
        suggestion: "Kürzere Sätze für bessere Lesbarkeit",
      });
    }
  }

  // Passive ratio check
  if (sentences.length >= 3) {
    const passivePatterns = /\bwird\b|\bwurde\b|\bwerden\b|\bwurden\b|\bworden\b/gi;
    const passiveSentences = sentences.filter((s) => passivePatterns.test(s)).length;
    const passiveRatio = passiveSentences / sentences.length;
    if (passiveRatio > lang.maxPassiveRatio) {
      penalty += Math.round((passiveRatio - lang.maxPassiveRatio) * 30);
      flags.push({
        layer: "C", code: "HIGH_PASSIVE_RATIO", severity: passiveRatio > 0.8 ? "warning" : "info",
        message: `Passivquote ${(passiveRatio * 100).toFixed(0)}% (max: ${(lang.maxPassiveRatio * 100).toFixed(0)}%)`,
        suggestion: "Aktiver formulieren für bessere Lernwirkung",
      });
    }
  }

  return penalty;
}

// ══════════════════════════════════════════════════
// Layer D: Didactic Quality (returns score + penalty)
// ══════════════════════════════════════════════════

function pushDidacticFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
  plainText: string,
): { score: number | null; penalty: number } {
  const at = input.artifact_type;
  const isLesson = at === "lesson";
  const isHandbook = at === "handbook_chapter";

  if (!isLesson && !isHandbook) return { score: null, penalty: 0 };

  const d = profile.didactics;
  let score = 100;
  const lower = plainText.toLowerCase();

  // Check for didactic structural elements (heuristic)
  if (d.requireEntryStep && !hasContentSignal(lower, ["einstieg", "lernziel", "überblick", "einführung", "vorwissen"])) {
    score -= 15;
    flags.push({ layer: "D", code: "MISSING_ENTRY_STEP", severity: "warning", message: "Einstiegsphase fehlt (Lernziel/Überblick)" });
  }
  if (d.requireExplanationStep && !hasContentSignal(lower, ["erklärung", "definition", "grundlage", "theorie", "konzept", "modell"])) {
    score -= 15;
    flags.push({ layer: "D", code: "MISSING_EXPLANATION", severity: "warning", message: "Erklärungsphase fehlt" });
  }
  if (d.requireApplicationStep && !hasContentSignal(lower, ["beispiel", "anwendung", "praxis", "fallbeispiel", "übung", "aufgabe", "szenario"])) {
    score -= 20;
    flags.push({ layer: "D", code: "MISSING_APPLICATION", severity: "error", message: "Anwendungs-/Beispielphase fehlt" });
  }
  if (d.requireRevisionStep && !hasContentSignal(lower, ["zusammenfassung", "wiederholung", "fazit", "kernpunkte", "merke"])) {
    score -= 10;
    flags.push({ layer: "D", code: "MISSING_REVISION", severity: "warning", message: "Wiederholungsphase fehlt" });
  }

  // Lesson-specific: transfer check
  if (isLesson && !hasContentSignal(lower, ["transfer", "übertragen", "anwenden", "praxisbeispiel", "fallbeispiel"])) {
    score -= 5;
    flags.push({ layer: "D", code: "MISSING_TRANSFER", severity: "info", message: "Kein Transferbezug erkannt" });
  }

  // Didactic score vs minimum
  if (score < d.minimumDidacticScore) {
    flags.push({
      layer: "D", code: "DIDACTIC_SCORE_LOW", severity: "error",
      message: `Didaktik-Score ${score} < Minimum ${d.minimumDidacticScore} (Modell: ${d.model})`,
    });
  }

  // Penalty: how far below 100? Scale to 0–30 range
  const penalty = Math.max(0, Math.round((100 - score) * 0.4));

  return { score, penalty };
}

function hasContentSignal(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

// ══════════════════════════════════════════════════
// Layer E: Context & Tutor (returns penalty 0–20)
// ══════════════════════════════════════════════════

function pushContextFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
): number {
  const isTutor = input.artifact_type === "tutor_response";
  if (!isTutor) return 0;

  const t = profile.tutor;
  let penalty = 0;

  if (t.requireReferencedCurriculumObject && !input.curriculum_id) {
    penalty += 10;
    flags.push({ layer: "E", code: "TUTOR_NO_CURRICULUM_REF", severity: "error", message: "Tutor-Antwort ohne Curriculum-Referenz" });
  }
  if (t.requireLearnerContext && !input.exam_session_id && !t.allowGeneralExplanationWithoutSession) {
    penalty += 5;
    flags.push({ layer: "E", code: "TUTOR_NO_SESSION_CONTEXT", severity: "warning", message: "Tutor-Antwort ohne Session-Kontext" });
  }
  if (t.requireModeConsistency && !input.tutor_mode) {
    penalty += 5;
    flags.push({ layer: "E", code: "TUTOR_NO_MODE", severity: "warning", message: "Tutor-Antwort ohne Modus-Angabe" });
  }

  return penalty;
}

// ══════════════════════════════════════════════════
// Status Resolution (score + hard rules)
// ══════════════════════════════════════════════════

function resolveAuditStatus(
  flags: AuditFlag[],
  genericScore: number,
  _profile: AuditProfile,
): AuditStatus {
  const hasCritical = flags.some((f) => f.severity === "critical");
  const errorCount = flags.filter((f) => f.severity === "error").length;

  // Hard rules first
  if (hasCritical) return "rejected";

  // Score-based rules
  if (genericScore >= 60) return "rejected";
  if (genericScore >= 40 || errorCount >= 3) return "rewrite";
  if (genericScore >= 15 || errorCount >= 1) return "review";

  // Warning-only
  const hasWarning = flags.some((f) => f.severity === "warning");
  if (hasWarning) return "review";

  return "approved";
}

// ── Re-export for convenience ──
export { getAuditProfile, normalizeTrack } from "./audit-profiles.ts";
export type { AuditFlag, AuditSeverity, AuditStatus, ContentAuditResult } from "./content-audit-types.ts";
