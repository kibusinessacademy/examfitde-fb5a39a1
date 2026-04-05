export type BlueprintQuestionSource = {
  id: string;
  curriculum_id: string;
  competency_id: string | null;
  learning_field_id?: string | null;
  name: string;
  canonical_statement: string;
  knowledge_type: string;
  cognitive_level: string;
  didactic_intent: string;
  exam_context_type: string;
  decision_structure: string | null;
  expected_trap_type: string | null;
  allowed_question_types: string[] | null;
  exam_relevance_score: number | null;
};

export type ExamQuestionRow = {
  certification_id: string;
  curriculum_id: string;
  competency_id: string | null;
  learning_field_id: string | null;
  blueprint_id: string;
  status: "draft" | "approved";
  review_state: "pending";
  question_type: string;
  question_text: string;
  options: Array<{ id: string; text: string; is_correct: boolean }>;
  correct_answer: number;
  explanation: string;
  trap_type: string;
  is_trap: boolean;
  conflict_type: string;
  distractor_meta: Record<string, unknown>;
  meta: Record<string, unknown>;
  cognitive_level: string;
  difficulty: string;
  ai_generated: boolean;
  qc_status: string;
  exam_part: string;
};

// Valid question_type values: concept, procedure, calculation, case_study, transfer
function pickQuestionType(_allowed: string[] | null | undefined, knowledgeType: string): string {
  switch (knowledgeType) {
    case "calculation": return "calculation";
    case "procedure": return "procedure";
    case "regulation": return "procedure"; // regulation maps to procedure type
    case "concept":
    default: return "concept";
  }
}

function buildQuestionText(bp: BlueprintQuestionSource): string {
  const stem = bp.canonical_statement?.trim() || bp.name?.trim() || "Kompetenzbezug fehlt";
  switch (bp.knowledge_type) {
    case "calculation":
      return `Welche Antwort ist im Kontext von "${stem}" rechnerisch und fachlich korrekt?`;
    case "regulation":
      return `Welche Aussage ist im Hinblick auf "${stem}" rechtlich bzw. regelkonform korrekt?`;
    case "procedure":
      return `Welche Vorgehensweise ist im Kontext von "${stem}" am sinnvollsten?`;
    case "concept":
    default:
      return `Welche Aussage beschreibt "${stem}" am treffendsten?`;
  }
}

function buildOptions(bp: BlueprintQuestionSource, questionType: string) {
  if (questionType === "true_false") {
    return [
      { id: "A", text: "Richtig", is_correct: true },
      { id: "B", text: "Falsch", is_correct: false },
    ];
  }

  const base = bp.canonical_statement?.trim() || bp.name?.trim() || "die Kompetenz";

  switch (bp.knowledge_type) {
    case "calculation":
      return [
        { id: "A", text: `Die rechnerisch und fachlich korrekte Lösung zu ${base}`, is_correct: true },
        { id: "B", text: `Ein typischer Rechenfehler bei ${base}`, is_correct: false },
        { id: "C", text: `Eine fachlich plausible, aber rechnerisch falsche Variante zu ${base}`, is_correct: false },
        { id: "D", text: `Eine Lösung mit falscher Methodik im Kontext von ${base}`, is_correct: false },
      ];
    case "regulation":
      return [
        { id: "A", text: `Die regel- bzw. rechtskonforme Einordnung zu ${base}`, is_correct: true },
        { id: "B", text: `Eine häufige Fehlinterpretation der Vorschrift bei ${base}`, is_correct: false },
        { id: "C", text: `Eine praxisnah klingende, aber unzulässige Lösung zu ${base}`, is_correct: false },
        { id: "D", text: `Eine nicht einschlägige Regelanwendung im Kontext von ${base}`, is_correct: false },
      ];
    case "procedure":
      return [
        { id: "A", text: `Die passendste Vorgehensweise für ${base}`, is_correct: true },
        { id: "B", text: `Ein typischer Ablauf mit vermeidbarem Fehler bei ${base}`, is_correct: false },
        { id: "C", text: `Eine unvollständige Vorgehensweise im Kontext von ${base}`, is_correct: false },
        { id: "D", text: `Eine plausible, aber unzweckmäßige Maßnahme zu ${base}`, is_correct: false },
      ];
    case "concept":
    default:
      return [
        { id: "A", text: `Die fachlich treffendste Beschreibung von ${base}`, is_correct: true },
        { id: "B", text: `Eine typische Fehlvorstellung zu ${base}`, is_correct: false },
        { id: "C", text: `Eine teilweise richtige, aber unpräzise Aussage zu ${base}`, is_correct: false },
        { id: "D", text: `Eine sachlich unpassende Einordnung von ${base}`, is_correct: false },
      ];
  }
}

function buildExplanation(bp: BlueprintQuestionSource): string {
  const base = bp.canonical_statement?.trim() || bp.name?.trim() || "die Kompetenz";
  switch (bp.knowledge_type) {
    case "calculation":
      return `Die richtige Antwort folgt der fachlich korrekten Rechenlogik und vermeidet typische Rechen- oder Methodenfehler im Kontext von "${base}".`;
    case "regulation":
      return `Die richtige Antwort ist regel- bzw. rechtskonform. Die anderen Optionen spiegeln typische Fehlinterpretationen oder unzutreffende Übertragungen auf "${base}" wider.`;
    case "procedure":
      return `Die richtige Antwort bildet die fachlich sinnvollste Vorgehensweise zu "${base}" ab. Die falschen Optionen enthalten typische Reihenfolge-, Vollständigkeits- oder Transferfehler.`;
    case "concept":
    default:
      return `Die richtige Antwort trifft den Kern von "${base}" am präzisesten. Die Distraktoren bilden typische Fehlvorstellungen, Unschärfen oder unpassende Übertragungen ab.`;
  }
}

function deriveConflictType(bp: BlueprintQuestionSource): string {
  if (bp.knowledge_type === "regulation") return "rule_conflict";
  if (bp.knowledge_type === "calculation") return "method_conflict";
  if (bp.knowledge_type === "procedure") return "process_conflict";
  return "concept_conflict";
}

/**
 * Derives exam_part from blueprint context.
 * Default: teil_1 (safe fallback for vocational exams).
 */
function deriveExamPart(bp: BlueprintQuestionSource): string {
  // Blueprints with exam_context_type hints
  const ctx = (bp.exam_context_type ?? "").toLowerCase();
  if (ctx.includes("teil_2") || ctx.includes("part_2") || ctx.includes("mündlich")) return "teil_2";
  if (ctx.includes("teil_1") || ctx.includes("part_1") || ctx.includes("schriftlich")) return "teil_1";
  // Default to teil_1 — safest for threshold checks
  return "teil_1";
}

/**
 * Derives difficulty from cognitive_level (Bloom taxonomy mapping).
 */
function deriveDifficulty(cognitiveLevel: string): string {
  switch (cognitiveLevel) {
    case "remember":
    case "understand":
      return "easy";
    case "apply":
      return "medium";
    case "analyze":
    case "evaluate":
    case "create":
      return "hard";
    default:
      return "medium";
  }
}

/**
 * Checks structural completeness for tier1 promotion eligibility.
 * Returns reason code if NOT eligible, null if promotable.
 */
function checkTier1Eligibility(bp: BlueprintQuestionSource, questionText: string, explanation: string): string | null {
  if (!bp.id) return "missing_blueprint_id";
  if (!bp.competency_id) return "missing_competency_id";
  if (!bp.curriculum_id) return "missing_curriculum_id";
  if (!bp.learning_field_id) return "missing_learning_field_id";
  if (!bp.cognitive_level) return "missing_cognitive_level";
  if (questionText.length < 60) return "question_text_too_short";
  if (!explanation || explanation.length < 20) return "explanation_too_short";
  return null;
}

export function buildExamQuestionRow(input: {
  certificationId: string;
  blueprint: BlueprintQuestionSource;
}): ExamQuestionRow {
  const bp = input.blueprint;
  const questionType = pickQuestionType(bp.allowed_question_types, bp.knowledge_type);
  const trapType = bp.expected_trap_type ?? "typical_error";
  const questionText = buildQuestionText(bp);
  const explanation = buildExplanation(bp);
  const examPart = deriveExamPart(bp);
  const difficulty = deriveDifficulty(bp.cognitive_level);

  // Structural validation for auto-promotion
  const blockReason = checkTier1Eligibility(bp, questionText, explanation);
  const isPromotable = blockReason === null;

  return {
    certification_id: input.certificationId,
    curriculum_id: bp.curriculum_id,
    competency_id: bp.competency_id,
    learning_field_id: bp.learning_field_id ?? null,
    blueprint_id: bp.id,
    status: "draft",
    review_state: "pending",
    question_type: questionType,
    question_text: questionText,
    options: buildOptions(bp, questionType),
    correct_answer: 0,
    explanation,
    trap_type: trapType,
    is_trap: true,
    conflict_type: deriveConflictType(bp),
    cognitive_level: bp.cognitive_level,
    difficulty,
    ai_generated: true,
    qc_status: isPromotable ? "tier1_passed" : "needs_review",
    exam_part: examPart,
    distractor_meta: {
      source_blueprint_id: bp.id,
      source_knowledge_type: bp.knowledge_type,
      source_exam_context_type: bp.exam_context_type,
      source_cognitive_level: bp.cognitive_level,
      expected_trap_type: trapType,
    },
    meta: {
      generator_version: "2026-04-05-exam-pool-v2",
      source: "blueprint_derived",
      didactic_intent: bp.didactic_intent,
      decision_structure: bp.decision_structure,
      exam_relevance_score: bp.exam_relevance_score ?? null,
      ...(blockReason ? { promotion_block_reason: blockReason } : {}),
    },
  };
}
