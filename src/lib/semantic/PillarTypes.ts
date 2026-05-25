/**
 * Phase P1 — Pillar Content Model.
 *
 * Eight pillar kinds, each anchored to an entity in the Knowledge Graph.
 * Pillar pages READ examiner outputs via the frozen Handover Contract;
 * they MUST NOT compute readiness, confidence, or verdicts themselves.
 */

import type { EntityKind } from "./types";

export type PillarKind =
  | "berufs_pillar"
  | "pruefungs_pillar"
  | "lernfeld_pillar"
  | "kompetenz_pillar"
  | "risiko_pillar"
  | "fehler_pillar"
  | "muendliche_pruefung_pillar"
  | "pruefungsstrategie_pillar";

/** Which graph-entity-kind anchors a pillar. */
export const PILLAR_ANCHOR: Readonly<Record<PillarKind, EntityKind>> = Object.freeze({
  berufs_pillar: "beruf",
  pruefungs_pillar: "pruefung",
  lernfeld_pillar: "lernfeld",
  kompetenz_pillar: "kompetenz",
  risiko_pillar: "risiko",
  fehler_pillar: "fehlerbild",
  muendliche_pruefung_pillar: "oral_pattern",
  pruefungsstrategie_pillar: "pruefungsstrategie",
});

export interface PillarBinding {
  kind: PillarKind;
  /** Entity ID this pillar is anchored to. */
  anchor_entity_id: string;
  /** Stable URL slug. Must be derived deterministically from the entity key. */
  slug: string;
  /**
   * Optional satellite anchors (related competencies, risks, etc.).
   * Resolved via `resolvers.ts`.
   */
  satellites?: ReadonlyArray<string>;
}

/** Reverse lookup: which pillar(s) could be anchored to this entity kind? */
export const ENTITY_TO_PILLARS: Readonly<Record<EntityKind, ReadonlyArray<PillarKind>>> = Object.freeze({
  beruf: ["berufs_pillar"],
  pruefung: ["pruefungs_pillar"],
  lernfeld: ["lernfeld_pillar"],
  kompetenz: ["kompetenz_pillar"],
  risiko: ["risiko_pillar"],
  fehlerbild: ["fehler_pillar"],
  pruefungsform: [],
  pruefungsstrategie: ["pruefungsstrategie_pillar"],
  oral_pattern: ["muendliche_pruefung_pillar"],
  industry_context: [],
  // W1 Cut 1 — no own pillar surface yet; consumed via satellites/resolvers.
  lernpfad: [],
  karrierepfad: [],
  tutor_topic: [],
  oral_exam_topic: ["muendliche_pruefung_pillar"],
  faq: [],
});
