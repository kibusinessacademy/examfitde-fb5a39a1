/**
 * Phase P1 — Knowledge Graph SSOT (types).
 *
 * Pure, deterministic entity + edge types for the ExamFit Pillar /
 * SRO / SEO / LLM authority architecture.
 *
 * HARD RULES (enforced by `scripts/guards/semantic-no-examiner-bypass.mjs`):
 *   - This module MUST NOT compute readiness, confidence, verdicts,
 *     evidence severity, or alternative risks.
 *   - All examiner-derived signals MUST come from `@/lib/examiner` via
 *     the frozen Handover Contract.
 *   - No motivational copy. No marketing fluff. Evidence-grounded only.
 */

/* ------------------------------------------------------------------ */
/* Entity kinds                                                       */
/* ------------------------------------------------------------------ */

export type EntityKind =
  | "beruf"
  | "pruefung"
  | "lernfeld"
  | "kompetenz"
  | "risiko"
  | "fehlerbild"
  | "pruefungsform"
  | "pruefungsstrategie"
  | "oral_pattern"
  | "industry_context"
  // W1 Cut 1 — Semantic Gravity additions
  | "lernpfad"
  | "karrierepfad"
  | "tutor_topic"
  | "oral_exam_topic"
  | "faq";

export interface SemanticEntityBase<K extends EntityKind = EntityKind> {
  /** Stable UUID or canonical key. Never derived from title. */
  id: string;
  /** Human-readable canonical key (slug-safe). Never used as SSOT join key — see `id`. */
  key: string;
  /** Human-readable name. UI-only. */
  name: string;
  kind: K;
  /** Short, sober description (≤ 280 chars). Never motivational. */
  description?: string;
  /** Free-form metadata. Must be deterministic per entity. */
  meta?: Readonly<Record<string, string | number | boolean | null>>;
}

export type Beruf = SemanticEntityBase<"beruf"> & {
  certification_id?: string;
  curriculum_id?: string;
  industry?: string;
};

export type Pruefung = SemanticEntityBase<"pruefung"> & {
  beruf_id: string;
  form: "schriftlich" | "muendlich" | "praktisch" | "fachgespraech";
};

export type Lernfeld = SemanticEntityBase<"lernfeld"> & {
  beruf_id: string;
  ordinal?: number;
};

export type Kompetenz = SemanticEntityBase<"kompetenz"> & {
  lernfeld_id?: string;
  beruf_id?: string;
  /** Optional difficulty signal (1..5). Purely descriptive, NOT derived from examiner. */
  difficulty?: 1 | 2 | 3 | 4 | 5;
};

export type Risiko = SemanticEntityBase<"risiko"> & {
  /** Linked competency this risk applies to. */
  kompetenz_id?: string;
  /**
   * Severity is mirrored from Examiner Handover Contract.
   * NEVER computed inside the semantic layer.
   */
  examiner_severity?: "info" | "warning" | "critical";
};

export type Fehlerbild = SemanticEntityBase<"fehlerbild"> & {
  kompetenz_id?: string;
  typical_in_form?: Pruefung["form"];
};

export type Pruefungsform = SemanticEntityBase<"pruefungsform">;
export type Pruefungsstrategie = SemanticEntityBase<"pruefungsstrategie">;

export type OralPattern = SemanticEntityBase<"oral_pattern"> & {
  beruf_id?: string;
  kompetenz_id?: string;
};

export type IndustryContext = SemanticEntityBase<"industry_context"> & {
  industry: string;
};

/* ---- W1 Cut 1 — Semantic Gravity additions ---- */

export type Lernpfad = SemanticEntityBase<"lernpfad"> & {
  beruf_id?: string;
  /** Ordered list of kompetenz ids in path order. Deterministic. */
  step_ids?: ReadonlyArray<string>;
  /** Optional terminal product (linked via lernpfad_leads_to_produkt edges in DB). */
  product_id?: string;
};

export type Karrierepfad = SemanticEntityBase<"karrierepfad"> & {
  from_beruf_id: string;
  to_beruf_id?: string;
  pathway?: "weiterbildung" | "studium" | "spezialisierung" | "fuehrung";
};

export type TutorTopic = SemanticEntityBase<"tutor_topic"> & {
  kompetenz_id?: string;
  /** Stable topic slug consumed by the AI tutor RAG layer (read-only here). */
  rag_topic_key?: string;
};

export type OralExamTopic = SemanticEntityBase<"oral_exam_topic"> & {
  pruefung_id?: string;
  beruf_id?: string;
};

export type Faq = SemanticEntityBase<"faq"> & {
  /** Polymorphic anchor — any entity id this FAQ belongs to. */
  anchor_entity_id?: string;
  question: string;
  answer: string;
};

export type SemanticEntity =
  | Beruf
  | Pruefung
  | Lernfeld
  | Kompetenz
  | Risiko
  | Fehlerbild
  | Pruefungsform
  | Pruefungsstrategie
  | OralPattern
  | IndustryContext
  | Lernpfad
  | Karrierepfad
  | TutorTopic
  | OralExamTopic
  | Faq;

/* ------------------------------------------------------------------ */
/* Edges                                                              */
/* ------------------------------------------------------------------ */

/**
 * Directed, typed edge between two entities. Edges are deterministic
 * and content-addressable: `(from, to, kind)` is unique.
 */
export type EdgeKind =
  | "beruf_has_pruefung"
  | "beruf_has_lernfeld"
  | "lernfeld_has_kompetenz"
  | "kompetenz_has_risiko"
  | "kompetenz_has_fehlerbild"
  | "pruefung_uses_form"
  | "pruefung_uses_strategie"
  | "kompetenz_has_oral_pattern"
  | "beruf_in_industry"
  | "related_competency"
  | "related_mistake"
  // W1 Cut 1 — Semantic Gravity additions
  | "kompetenz_has_lernpfad"
  | "lernpfad_leads_to_produkt"
  | "beruf_has_karrierepfad"
  | "kompetenz_has_tutor_topic"
  | "pruefung_has_oral_exam_topic"
  | "entity_has_faq";

export interface SemanticEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /**
   * Optional confidence in the *relation existence*, 0..1.
   * NOT readiness confidence — must never feed back into Examiner.
   */
  weight?: number;
}

/* ------------------------------------------------------------------ */
/* Graph                                                              */
/* ------------------------------------------------------------------ */

export interface KnowledgeGraphSnapshot {
  entities: ReadonlyArray<SemanticEntity>;
  edges: ReadonlyArray<SemanticEdge>;
  /** ISO-8601 timestamp of the snapshot — deterministic input only. */
  snapshot_at: string;
}

/* ------------------------------------------------------------------ */
/* Type guards                                                        */
/* ------------------------------------------------------------------ */

export const isEntity = <K extends EntityKind>(e: SemanticEntity, k: K): e is Extract<SemanticEntity, { kind: K }> =>
  e.kind === k;
