/**
 * VISUAL.LEARNING.OS — Test/Preview Fixtures (Cut 4).
 *
 * NICHT für echte Persistenz. NICHT als Lernenden-Default. Nur für Tests
 * und Preview-Stages. Drafts werden bewusst NICHT exportiert, damit sie
 * niemals an Lernenden-Komponenten gegeben werden können.
 */
import type {
  PublishedVisualArtifact,
  VisualLearningArtifact,
} from "./contracts";

const FIXED_TS = "1970-01-01T00:00:00.000Z";

function asPublished(a: VisualLearningArtifact): PublishedVisualArtifact {
  if (a.status !== "approved" && a.status !== "published") {
    throw new Error("Fixture must be approved or published");
  }
  return a as PublishedVisualArtifact;
}

/** Learner-safe, approved Fixture für Lesson-Integration. */
export const LEARNER_SAFE_FIXTURE_ARTIFACT: PublishedVisualArtifact = asPublished({
  id: "fixture-art-approved-1",
  contract_version: "1.0.0",
  curriculum_id: "fixture-curr",
  competence_id: "fixture-comp",
  lesson_id: "fixture-lesson",
  artifact_type: "process_flow",
  purpose: "learn",
  title: "Beispiel: Linearer Ablauf",
  focus_question: "In welcher Reihenfolge laufen die Schritte ab?",
  nodes: [
    { id: "n1", role: "process_step", label: "Schritt A" },
    { id: "n2", role: "process_step", label: "Schritt B" },
    { id: "n3", role: "rule", label: "Pflichtprüfung" },
  ],
  edges: [
    { from: "n1", to: "n2", kind: "precedes" },
    { from: "n2", to: "n3", kind: "requires" },
  ],
  misconceptions: [
    { kind: "false_order", description: "Schritte werden vertauscht." },
  ],
  accessibility: {
    text_summary: "Ablauf A → B mit anschließender Pflichtprüfung.",
    color_independent_labels: true,
    screen_reader_description: "Drei Knoten, zwei Kanten. Linearer Prozess.",
  },
  status: "approved",
  version: 1,
  created_at: FIXED_TS,
  updated_at: FIXED_TS,
});

/** Zweites learner-safe Artefakt zum Testen von Supporting/Sortierung. */
export const LEARNER_SAFE_FIXTURE_ARTIFACT_2: PublishedVisualArtifact = asPublished({
  ...LEARNER_SAFE_FIXTURE_ARTIFACT,
  id: "fixture-art-approved-2",
  title: "Beispiel: Zusatzstruktur",
  focus_question: "Welche Regel begleitet den Ablauf?",
  version: 1,
  status: "published",
});

/**
 * Cut 5 — Learner-safe Artefakt mit Misconception, die per
 * blueprint_misconception_id mappingfähig ist.
 */
export const LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION: PublishedVisualArtifact =
  asPublished({
    id: "fixture-art-approved-mapped",
    contract_version: "1.0.0",
    curriculum_id: "fixture-curr",
    competence_id: "fixture-comp",
    lesson_id: "fixture-lesson",
    artifact_type: "process_flow",
    purpose: "practice",
    title: "Mapping-Beispiel: Reihenfolge",
    focus_question: "Welche Reihenfolge ist korrekt?",
    nodes: [
      { id: "n1", role: "process_step", label: "Antrag prüfen" },
      { id: "n2", role: "process_step", label: "Freigabe einholen" },
      { id: "n3", role: "rule", label: "Vier-Augen-Prinzip" },
    ],
    edges: [
      { from: "n1", to: "n2", kind: "precedes" },
      { from: "n2", to: "n3", kind: "requires" },
    ],
    misconceptions: [
      {
        kind: "false_order",
        target_edge: { from: "n1", to: "n2" },
        description: "Freigabe vor Prüfung wird angenommen.",
        blueprint_misconception_id: "mc-1",
      },
    ],
    accessibility: {
      text_summary: "Antrag prüfen → Freigabe einholen → Vier-Augen-Prinzip.",
      color_independent_labels: true,
      screen_reader_description: "Drei Knoten, zwei Kanten, klare Reihenfolge.",
    },
    status: "approved",
    version: 1,
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
  });

/** Cut 5 — Learner-safe Antwortsignale für Tests. */
export const LEARNER_SAFE_MINICHECK_ANSWER_SIGNALS = Object.freeze([
  { question_id: "q1", question_order: 1, correctness: "incorrect", answer_key: "a-wrong" },
  { question_id: "q2", question_order: 2, correctness: "correct" },
  { question_id: "q3", question_order: 3, correctness: "unsure" },
] as const);

/** Cut 5 — Learner-safe Mappings für Tests. */
export const LEARNER_SAFE_MINICHECK_VISUAL_MAPPINGS = Object.freeze([
  {
    question_id: "q1",
    answer_key: "a-wrong",
    misconception_id: "mc-1",
    visual_artifact_id: "fixture-art-approved-mapped",
  },
  {
    question_id: "q3",
    misconception_id: "mc-1",
    visual_artifact_id: "fixture-art-approved-mapped",
  },
] as const);

// ---------------------------------------------------------------------------
// Cut 6 — AI Draft Fixtures (Admin-only, NIEMALS learner-visible).
// ---------------------------------------------------------------------------

import type {
  VisualAiDraftContext,
  VisualAiRawOutput,
} from "./ai-draft-contracts";

const AI_FIXTURE_SOURCE_REF = "ssot://curriculum/fixture-curr#fixture-comp";

/** Admin-only Fixture: gültiger AI-Draft-Kontext. */
export const ADMIN_ONLY_AI_DRAFT_CONTEXT_FIXTURE: VisualAiDraftContext = {
  artifact_id: "fixture-ai-art-1",
  curriculum_id: "fixture-curr",
  competence_id: "fixture-comp",
  lesson_id: "fixture-lesson",
  purpose: "learn",
  competence_facets: { requires_sequence_understanding: true },
  source_refs: [AI_FIXTURE_SOURCE_REF],
};

/** Admin-only Fixture: gültiger AI-Roh-Output, der die Pipeline passiert. */
export const ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_VALID: VisualAiRawOutput = {
  title: "AI-Beispiel: Linearer Ablauf",
  focus_question: "In welcher Reihenfolge laufen die Schritte ab?",
  nodes: [
    { id: "n1", role: "process_step", label: "Schritt A", source_ref: AI_FIXTURE_SOURCE_REF },
    { id: "n2", role: "process_step", label: "Schritt B", source_ref: AI_FIXTURE_SOURCE_REF },
    { id: "n3", role: "rule", label: "Pflichtprüfung", source_ref: AI_FIXTURE_SOURCE_REF },
  ],
  edges: [
    { from: "n1", to: "n2", kind: "precedes", source_ref: AI_FIXTURE_SOURCE_REF },
    { from: "n2", to: "n3", kind: "requires", source_ref: AI_FIXTURE_SOURCE_REF },
  ],
  misconceptions: [
    {
      kind: "false_order",
      description: "Schritte werden vertauscht.",
      source_ref: AI_FIXTURE_SOURCE_REF,
    },
  ],
};

/** Admin-only Fixture: enthält verbotene Hex-Farbe → muss blockieren. */
export const ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_HEX_COLOR: VisualAiRawOutput = {
  nodes: [
    {
      id: "n1",
      role: "process_step",
      label: "Schritt #ff0000",
      source_ref: AI_FIXTURE_SOURCE_REF,
    },
    { id: "n2", role: "process_step", label: "Schritt B", source_ref: AI_FIXTURE_SOURCE_REF },
  ],
  edges: [{ from: "n1", to: "n2", kind: "precedes", source_ref: AI_FIXTURE_SOURCE_REF }],
};

/** Admin-only Fixture: unbekannter Node Type → muss blockieren/verworfen werden. */
export const ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_UNKNOWN_NODE: VisualAiRawOutput = {
  nodes: [
    { id: "n1", role: "process_step", label: "Schritt A", source_ref: AI_FIXTURE_SOURCE_REF },
    {
      id: "n2",
      role: "spaceship",
      label: "Unsinnig",
      source_ref: AI_FIXTURE_SOURCE_REF,
    },
  ],
  edges: [{ from: "n1", to: "n2", kind: "precedes", source_ref: AI_FIXTURE_SOURCE_REF }],
};

/** Admin-only Fixture: fehlende source_refs → muss blockieren. */
export const ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_MISSING_REFS: VisualAiRawOutput = {
  nodes: [
    { id: "n1", role: "process_step", label: "Schritt A" },
    { id: "n2", role: "process_step", label: "Schritt B" },
  ],
  edges: [{ from: "n1", to: "n2", kind: "precedes" }],
};

