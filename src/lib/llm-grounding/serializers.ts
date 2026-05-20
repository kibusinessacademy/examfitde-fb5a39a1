/**
 * Phase P2 — Retrieval-first entity serializers.
 *
 * Pure functions: (graph, entity) → GroundedChunk[]. No I/O, no random,
 * no LLM. Output is byte-stable for identical input.
 *
 * Each chunk has ≥1 citation pointing back into the Knowledge Graph or
 * the Examiner Handover Contract.
 */

import type { KnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import {
  relatedCompetencies,
  relatedExamScenarios,
  relatedMistakes,
  relatedRisks,
} from "@/lib/semantic/resolvers";
import type {
  Beruf,
  Kompetenz,
  Lernfeld,
  Pruefung,
  SemanticEntity,
} from "@/lib/semantic/types";

import { chunkHash } from "./hash";
import type { Citation, GroundedChunk, ChunkRole } from "./types";

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

const cite = (
  source_id: string,
  source_kind: Citation["source_kind"],
  anchor?: string,
): Citation => ({ source_id, source_kind, anchor, contract_version: "1.0.0" });

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";

const headline = (s: string): string => truncate(s.replace(/\s+/g, " ").trim(), 120);
const body = (s: string): string => truncate(s.replace(/\s+/g, " ").trim(), 1200);

function makeChunk(args: {
  role: ChunkRole;
  anchor: SemanticEntity;
  headline: string;
  body: string;
  citations: ReadonlyArray<Citation>;
  snapshot_at: string;
}): GroundedChunk {
  const normalisedBody = args.body.replace(/\s+/g, " ").trim().toLowerCase();
  return {
    chunk_id: chunkHash([args.role, args.anchor.id, normalisedBody]),
    role: args.role,
    anchor_entity_id: args.anchor.id,
    anchor_entity_kind: args.anchor.kind,
    headline: headline(args.headline),
    body: body(args.body),
    citations: args.citations,
    snapshot_at: args.snapshot_at,
  };
}

/* ------------------------------------------------------------------ */
/* Beruf                                                              */
/* ------------------------------------------------------------------ */

export function serialiseBeruf(graph: KnowledgeGraph, beruf: Beruf): ReadonlyArray<GroundedChunk> {
  const out: GroundedChunk[] = [];
  const snap = graph.snapshot_at;

  out.push(
    makeChunk({
      role: "definition",
      anchor: beruf,
      headline: `${beruf.name} — Definition`,
      body:
        beruf.description ??
        `${beruf.name} ist ein anerkannter Ausbildungsberuf. Strukturierte Lernfelder und Prüfungsformen sind über die Ausbildungsordnung definiert.`,
      citations: [cite(beruf.id, "graph_entity")],
      snapshot_at: snap,
    }),
  );

  const lernfelder = graph
    .resolveTargets(graph.outgoingEdges(beruf.id, "beruf_has_lernfeld"))
    .filter((e): e is Lernfeld => e.kind === "lernfeld");

  if (lernfelder.length > 0) {
    out.push(
      makeChunk({
        role: "scope",
        anchor: beruf,
        headline: `${beruf.name} — Lernfelder`,
        body: `Der Beruf umfasst ${lernfelder.length} Lernfelder: ${lernfelder
          .map((l) => l.name)
          .join("; ")}.`,
        citations: [
          cite(beruf.id, "graph_entity"),
          ...lernfelder.slice(0, 5).map((l) => cite(l.id, "graph_entity")),
        ],
        snapshot_at: snap,
      }),
    );
  }

  const scenarios = relatedExamScenarios(graph, beruf.id);
  if (scenarios.length > 0) {
    out.push(
      makeChunk({
        role: "exam_form",
        anchor: beruf,
        headline: `${beruf.name} — Prüfungsformen`,
        body: scenarios.map((p) => `${p.name} (${p.form})`).join("; ") + ".",
        citations: scenarios.slice(0, 5).map((p) => cite(p.id, "graph_entity")),
        snapshot_at: snap,
      }),
    );
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Pruefung                                                           */
/* ------------------------------------------------------------------ */

export function serialisePruefung(graph: KnowledgeGraph, pruefung: Pruefung): ReadonlyArray<GroundedChunk> {
  const out: GroundedChunk[] = [];
  const snap = graph.snapshot_at;

  out.push(
    makeChunk({
      role: "exam_form",
      anchor: pruefung,
      headline: `${pruefung.name} — Format`,
      body:
        pruefung.description ??
        `Die Prüfung ${pruefung.name} wird in der Form "${pruefung.form}" durchgeführt.`,
      citations: [
        cite(pruefung.id, "graph_entity"),
        cite(pruefung.beruf_id, "graph_entity"),
      ],
      snapshot_at: snap,
    }),
  );

  return out;
}

/* ------------------------------------------------------------------ */
/* Kompetenz                                                          */
/* ------------------------------------------------------------------ */

export function serialiseKompetenz(graph: KnowledgeGraph, kompetenz: Kompetenz): ReadonlyArray<GroundedChunk> {
  const out: GroundedChunk[] = [];
  const snap = graph.snapshot_at;

  out.push(
    makeChunk({
      role: "definition",
      anchor: kompetenz,
      headline: `${kompetenz.name} — Beschreibung`,
      body:
        kompetenz.description ??
        `${kompetenz.name} ist eine prüfungsrelevante Kompetenz. Sie wird über strukturierte Aufgaben und Fragestellungen geprüft.`,
      citations: [cite(kompetenz.id, "graph_entity")],
      snapshot_at: snap,
    }),
  );

  const risks = relatedRisks(graph, kompetenz.id);
  if (risks.length > 0) {
    out.push(
      makeChunk({
        role: "risk_profile",
        anchor: kompetenz,
        headline: `${kompetenz.name} — Typische Risiken`,
        body:
          `Beobachtete Risikomuster bei ${kompetenz.name}: ` +
          risks.map((r) => r.name).join("; ") +
          ".",
        citations: [
          cite(kompetenz.id, "graph_entity"),
          ...risks.slice(0, 5).map((r) => cite(r.id, "graph_entity")),
        ],
        snapshot_at: snap,
      }),
    );
  }

  const mistakes = relatedMistakes(graph, kompetenz.id);
  if (mistakes.length > 0) {
    out.push(
      makeChunk({
        role: "risk_profile",
        anchor: kompetenz,
        headline: `${kompetenz.name} — Typische Fehlerbilder`,
        body:
          `Häufig beobachtete Fehlerbilder: ` +
          mistakes.map((m) => m.name).join("; ") +
          ".",
        citations: [
          cite(kompetenz.id, "graph_entity"),
          ...mistakes.slice(0, 5).map((m) => cite(m.id, "graph_entity")),
        ],
        snapshot_at: snap,
      }),
    );
  }

  const peers = relatedCompetencies(graph, kompetenz.id).filter((k) => k.id !== kompetenz.id);
  if (peers.length > 0) {
    out.push(
      makeChunk({
        role: "related_links",
        anchor: kompetenz,
        headline: `${kompetenz.name} — Verwandte Kompetenzen`,
        body: peers.slice(0, 8).map((k) => k.name).join("; ") + ".",
        citations: [
          cite(kompetenz.id, "graph_entity"),
          ...peers.slice(0, 5).map((k) => cite(k.id, "graph_entity")),
        ],
        snapshot_at: snap,
      }),
    );
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Generic entity entry point                                         */
/* ------------------------------------------------------------------ */

export function serialiseEntity(graph: KnowledgeGraph, entity: SemanticEntity): ReadonlyArray<GroundedChunk> {
  if (entity.kind === "beruf") return serialiseBeruf(graph, entity as Beruf);
  if (entity.kind === "pruefung") return serialisePruefung(graph, entity as Pruefung);
  if (entity.kind === "kompetenz") return serialiseKompetenz(graph, entity as Kompetenz);

  // Fallback: a minimal definition chunk so retrieval is never empty.
  const snap = graph.snapshot_at;
  return [
    makeChunk({
      role: "definition",
      anchor: entity,
      headline: `${entity.name} — ${entity.kind}`,
      body: entity.description ?? `${entity.name} (${entity.kind}).`,
      citations: [cite(entity.id, "graph_entity")],
      snapshot_at: snap,
    }),
  ];
}
