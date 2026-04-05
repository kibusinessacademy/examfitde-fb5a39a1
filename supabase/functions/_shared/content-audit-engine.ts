/**
 * Content Audit Engine — SSOT
 *
 * Core audit logic that applies track-aware profiles to any artifact.
 * Layers:
 *   A — Structural Integrity
 *   B — Exam & Content Quality
 *   C — Language Quality (generic phrases, spelling, sentence length)
 *   D — Didactic Quality
 *   E — Context & Tutor Quality
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

// ── Main Entry Point ──

export function runContentAudit(input: AuditInput): ContentAuditResult {
  const profile = getAuditProfile(input.track);
  const flags: AuditFlag[] = [];
  const content = String(input.content ?? "");

  // ─── Layer A — Structural Integrity ───
  pushStructuralFlags(flags, input, profile);

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
  pushExamQualityFlags(flags, input, profile);

  // ─── Layer C — Language Quality ───
  const genericScore = pushLanguageFlags(flags, content, input, profile);

  // ─── Layer D — Didactic Quality ───
  const didacticScore = pushDidacticFlags(flags, input, profile);

  // ─── Layer E — Context & Tutor Quality ───
  pushContextFlags(flags, input, profile);

  // ─── Resolve final status ───
  const auditStatus = resolveAuditStatus(flags, profile);

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

// ── Layer A: Structural ──

function pushStructuralFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
) {
  const s = profile.structural;
  const isQuestion = ["exam_question", "minicheck_question"].includes(input.artifact_type);
  const isLesson = input.artifact_type === "lesson";

  if (s.requireCurriculum && !input.curriculum_id) {
    flags.push({ layer: "A", code: "MISSING_CURRICULUM", severity: "critical", field: "curriculum_id", message: "Curriculum-Referenz fehlt" });
  }
  if (s.requireCompetency && !input.competency_id) {
    flags.push({ layer: "A", code: "MISSING_COMPETENCY", severity: "error", field: "competency_id", message: "Kompetenz-Referenz fehlt" });
  }
  if (s.requireBlueprintForQuestions && isQuestion && !input.blueprint_id) {
    flags.push({ layer: "A", code: "MISSING_BLUEPRINT", severity: "error", field: "blueprint_id", message: "Blueprint-Referenz fehlt für Prüfungsfrage" });
  }
  if (s.requireBlueprintForLessons && isLesson && !input.blueprint_id) {
    flags.push({ layer: "A", code: "MISSING_LESSON_BLUEPRINT", severity: "warning", field: "blueprint_id", message: "Lesson ohne Blueprint-Referenz" });
  }
  if (s.requireLessonToLearningField && isLesson && !input.learning_field_id) {
    flags.push({ layer: "A", code: "MISSING_LEARNING_FIELD", severity: "error", field: "learning_field_id", message: "Lektion ohne Lernfeld-Zuordnung" });
  }
  if (s.requireExamTypeTag && isQuestion && !input.exam_type) {
    flags.push({ layer: "A", code: "MISSING_EXAM_TYPE", severity: "warning", field: "exam_type", message: "Prüfungstyp-Tag fehlt" });
  }
  if (s.requireDifficulty && isQuestion && !input.difficulty) {
    flags.push({ layer: "A", code: "MISSING_DIFFICULTY", severity: "warning", field: "difficulty", message: "Schwierigkeitsgrad fehlt" });
  }
  if (s.requireWeightPercentage && isQuestion && input.weight_percentage == null) {
    flags.push({ layer: "A", code: "MISSING_WEIGHT", severity: "info", field: "weight_percentage", message: "Gewichtung fehlt" });
  }

  // Content must exist
  if (!input.content || String(input.content).replace(/<[^>]+>/g, "").trim().length < 20) {
    flags.push({ layer: "A", code: "CONTENT_TOO_SHORT", severity: "critical", field: "content", message: "Inhalt fehlt oder ist zu kurz (< 20 Zeichen)" });
  }
}

// ── Layer B: Exam Quality ──

function pushExamQualityFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
) {
  const eq = profile.examQuality;
  const isQuestion = ["exam_question", "minicheck_question"].includes(input.artifact_type);

  if (!isQuestion) return;

  if (eq.requireOperatorSignal) {
    const text = String(input.content ?? "").toLowerCase();
    const hasOperator = profile.language.operatorSet.some((op) =>
      text.includes(op.toLowerCase())
    );
    if (!hasOperator) {
      flags.push({
        layer: "B",
        code: "MISSING_OPERATOR",
        severity: "warning",
        message: `Kein Operator-Signal gefunden (erwartet: ${profile.language.operatorSet.slice(0, 4).join(", ")}…)`,
        suggestion: "Frage sollte mindestens einen fachlichen Operator enthalten",
      });
    }
  }
}

// ── Layer C: Language Quality ──

function pushLanguageFlags(
  flags: AuditFlag[],
  content: string,
  input: AuditInput,
  profile: AuditProfile,
): number {
  const lang = profile.language;

  // Generic content detection
  let genericScore = 0;
  if (lang.enableGenericPhraseDetection || lang.enableSpellingChecks) {
    const detection = detectGenericContent(content);
    genericScore = Math.round(detection.genericRatio * 100);

    if (lang.enableGenericPhraseDetection && detection.genericPhraseCount > 0) {
      const sev: AuditSeverity =
        detection.genericRatio >= 0.20 ? "critical" :
        detection.genericRatio >= 0.12 ? "error" :
        detection.genericPhraseCount >= 3 ? "warning" : "info";

      if (sev !== "info") {
        flags.push({
          layer: "C",
          code: "GENERIC_PHRASES",
          severity: sev,
          message: `${detection.genericPhraseCount} generische Füllphrasen erkannt (Ratio: ${(detection.genericRatio * 100).toFixed(1)}%)`,
          suggestion: "Fachspezifisch umformulieren, Prüfungsbezug herstellen",
        });
      }
    }

    if (lang.enableSpellingChecks && detection.spellingErrors.length > 0) {
      const sev: AuditSeverity = detection.spellingErrors.length >= 4 ? "critical" :
        detection.spellingErrors.length >= 2 ? "error" : "warning";

      flags.push({
        layer: "C",
        code: "SPELLING_ERRORS",
        severity: sev,
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
      flags.push({
        layer: "C",
        code: "SENTENCE_TOO_LONG",
        severity: "warning",
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
      flags.push({
        layer: "C",
        code: "HIGH_PASSIVE_RATIO",
        severity: "info",
        message: `Passivquote ${(passiveRatio * 100).toFixed(0)}% (max: ${(lang.maxPassiveRatio * 100).toFixed(0)}%)`,
        suggestion: "Aktiver formulieren für bessere Lernwirkung",
      });
    }
  }

  return genericScore;
}

// ── Layer D: Didactic Quality ──

function pushDidacticFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
): number | null {
  const isLesson = input.artifact_type === "lesson";
  const isHandbook = input.artifact_type === "handbook_chapter";

  if (!isLesson && !isHandbook) return null;

  const d = profile.didactics;
  let score = 100;
  const content = String(input.content ?? "").toLowerCase();

  // Check for didactic structural elements (heuristic)
  if (d.requireEntryStep && !hasContentSignal(content, ["einstieg", "lernziel", "überblick", "einführung"])) {
    score -= 15;
    flags.push({ layer: "D", code: "MISSING_ENTRY_STEP", severity: "warning", message: "Einstiegsphase fehlt" });
  }
  if (d.requireExplanationStep && !hasContentSignal(content, ["erklärung", "definition", "grundlage", "theorie", "konzept"])) {
    score -= 15;
    flags.push({ layer: "D", code: "MISSING_EXPLANATION", severity: "warning", message: "Erklärungsphase fehlt" });
  }
  if (d.requireApplicationStep && !hasContentSignal(content, ["beispiel", "anwendung", "praxis", "fallbeispiel", "übung"])) {
    score -= 15;
    flags.push({ layer: "D", code: "MISSING_APPLICATION", severity: "warning", message: "Anwendungsphase fehlt" });
  }
  if (d.requireRevisionStep && !hasContentSignal(content, ["zusammenfassung", "wiederholung", "fazit", "kernpunkte"])) {
    score -= 10;
    flags.push({ layer: "D", code: "MISSING_REVISION", severity: "info", message: "Wiederholungsphase fehlt" });
  }

  if (score < d.minimumDidacticScore) {
    flags.push({
      layer: "D",
      code: "DIDACTIC_SCORE_LOW",
      severity: "error",
      message: `Didaktik-Score ${score} < Minimum ${d.minimumDidacticScore} (Modell: ${d.model})`,
    });
  }

  return score;
}

function hasContentSignal(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

// ── Layer E: Context & Tutor ──

function pushContextFlags(
  flags: AuditFlag[],
  input: AuditInput,
  profile: AuditProfile,
) {
  const isTutor = input.artifact_type === "tutor_response";
  if (!isTutor) return;

  const t = profile.tutor;

  if (t.requireReferencedCurriculumObject && !input.curriculum_id) {
    flags.push({ layer: "E", code: "TUTOR_NO_CURRICULUM_REF", severity: "error", message: "Tutor-Antwort ohne Curriculum-Referenz" });
  }
  if (t.requireLearnerContext && !input.exam_session_id && !t.allowGeneralExplanationWithoutSession) {
    flags.push({ layer: "E", code: "TUTOR_NO_SESSION_CONTEXT", severity: "warning", message: "Tutor-Antwort ohne Session-Kontext" });
  }
}

// ── Status Resolution ──

function resolveAuditStatus(flags: AuditFlag[], profile: AuditProfile): AuditStatus {
  const hasCritical = flags.some((f) => f.severity === "critical");
  const hasError = flags.some((f) => f.severity === "error");
  const hasWarning = flags.some((f) => f.severity === "warning");
  const errorCount = flags.filter((f) => f.severity === "error").length;

  if (hasCritical) return "rejected";
  if (errorCount >= 3) return "rewrite";
  if (hasError) return "review";
  if (hasWarning) return "review";
  return "approved";
}

// ── Re-export for convenience ──
export { getAuditProfile, normalizeTrack } from "./audit-profiles.ts";
export type { AuditFlag, AuditSeverity, AuditStatus, ContentAuditResult } from "./content-audit-types.ts";
