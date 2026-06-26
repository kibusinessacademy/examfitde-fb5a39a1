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
