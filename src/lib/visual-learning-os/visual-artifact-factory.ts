/**
 * VISUAL.LEARNING.OS — Visual Artifact Factory (Cut 2).
 *
 * Pure, deterministische Funktion. Kein DB/HTTP/Clock/RNG/FS.
 * Erzeugt aus Curriculum + Competence + Blueprint + Purpose ein
 * VisualLearningArtifact im Status `draft` oder `needs_review` (→ `review`).
 *
 * Die Factory entscheidet NICHT über approved/published. Das Review-Gate
 * (visual-artifact-review.ts) prüft danach.
 */
import {
  VISUAL_LEARNING_OS_CONTRACT_VERSION,
  type VisualArtifactType,
  type VisualEdge,
  type VisualLearningArtifact,
  type VisualMisconception,
  type VisualNode,
  type VisualPurpose,
} from "./contracts";
import {
  selectVisualPatternForCompetence,
  type CompetenceVisualFacets,
} from "./visual-pattern-registry";
import { DEFAULT_RUBRICS } from "./visual-assessment";
import { NODE_GRAMMAR } from "./visual-grammar";

export interface VisualArtifactFactoryInput {
  /** Deterministisch übergeben (UUID), niemals erfunden. */
  artifact_id: string;
  curriculum_id: string;
  competence_id: string;
  lesson_id?: string;
  blueprint_id?: string;
  purpose: VisualPurpose;
  competence_facets: CompetenceVisualFacets;
  /** Pflicht-Quellen für jede fachliche Aussage. */
  source_refs: string[];
  /** Optional vorgemerkte Strukturelemente. */
  seed_nodes?: VisualNode[];
  seed_edges?: VisualEdge[];
  misconceptions?: VisualMisconception[];
  /** Optionaler Titel / Fokusfrage. Fallbacks deterministisch ableitbar. */
  title?: string;
  focus_question?: string;
  /** Deterministischer Zeitstempel für reine Tests. Default: epoch 0. */
  created_at?: string;
}

export interface VisualArtifactDraft {
  artifact: VisualLearningArtifact;
  pattern_rationale: string;
}

const EPOCH = "1970-01-01T00:00:00.000Z";

/** Deterministisches Sortieren — keine Locale, keine RNG. */
function sortNodes(nodes: VisualNode[]): VisualNode[] {
  return [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortEdges(edges: VisualEdge[]): VisualEdge[] {
  return [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
}

function normalizeNode(n: VisualNode): VisualNode {
  return {
    id: n.id,
    role: n.role,
    label: n.label?.trim() ?? "",
    glossary_key: n.glossary_key,
    aria_label: n.aria_label?.trim() || undefined,
    x: n.x,
    y: n.y,
  };
}

function normalizeEdge(e: VisualEdge): VisualEdge {
  return {
    from: e.from,
    to: e.to,
    kind: e.kind,
    label: e.label?.trim() || undefined,
  };
}

function deriveTitle(artifactType: VisualArtifactType, input: VisualArtifactFactoryInput): string {
  if (input.title?.trim()) return input.title.trim();
  return `${artifactType}:${input.competence_id}`;
}

function deriveFocusQuestion(
  artifactType: VisualArtifactType,
  input: VisualArtifactFactoryInput,
): string {
  if (input.focus_question?.trim()) return input.focus_question.trim();
  return `Welche Zusammenhänge zeigt ${artifactType} für Kompetenz ${input.competence_id}?`;
}

/**
 * Erzeugt ein deterministisches VisualLearningArtifact.
 * - kein Output mit status `approved` oder `published`
 * - status = `review`, wenn seed_nodes/seed_edges vorhanden (für Review-Gate)
 * - status = `draft`, wenn noch ohne Strukturkern
 */
export function buildVisualLearningArtifact(
  input: VisualArtifactFactoryInput,
): VisualArtifactDraft {
  const { artifact_type, rationale } = selectVisualPatternForCompetence(
    input.competence_facets,
    input.purpose,
  );

  const seededNodes = (input.seed_nodes ?? []).map(normalizeNode);
  const seededEdges = (input.seed_edges ?? []).map(normalizeEdge);
  const nodes = sortNodes(seededNodes);
  const edges = sortEdges(seededEdges);

  // Validierung: Nodes nutzen nur bekannte Rollen aus NODE_GRAMMAR (Grammar-only).
  for (const n of nodes) {
    if (!NODE_GRAMMAR[n.role]) {
      throw new Error(
        `[visual-artifact-factory] Unknown node role "${n.role}" — must come from NODE_GRAMMAR.`,
      );
    }
  }

  const hasStructure = nodes.length > 0 && edges.length > 0;
  const status = hasStructure ? "review" : "draft";

  const created_at = input.created_at ?? EPOCH;

  const artifact: VisualLearningArtifact = {
    id: input.artifact_id,
    contract_version: VISUAL_LEARNING_OS_CONTRACT_VERSION,
    curriculum_id: input.curriculum_id,
    competence_id: input.competence_id,
    lesson_id: input.lesson_id,
    blueprint_id: input.blueprint_id,
    artifact_type,
    purpose: input.purpose,
    title: deriveTitle(artifact_type, input),
    focus_question: deriveFocusQuestion(artifact_type, input),
    nodes,
    edges,
    misconceptions: input.misconceptions
      ? [...input.misconceptions].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
      : undefined,
    assessment_rubric: DEFAULT_RUBRICS[artifact_type],
    accessibility: {
      text_summary: "",
      color_independent_labels: false,
      screen_reader_description: "",
    },
    status,
    version: 1,
    created_at,
    updated_at: created_at,
  };

  return { artifact, pattern_rationale: rationale };
}
