/**
 * Phase P2 — Deterministic FAQ generation.
 *
 * This is NOT an LLM call. FAQ pairs are templated from the
 * Knowledge Graph + (optional) Examiner Handover and are byte-stable
 * for identical input.
 *
 * Why deterministic: AI citation systems (Perplexity, ChatGPT search,
 * Google AI Overviews) reward verifiable, stable answers. Generated
 * copy regenerates on every crawl and degrades trust.
 */

import type { KnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import {
  relatedCompetencies,
  relatedExamScenarios,
  relatedRisks,
} from "@/lib/semantic/resolvers";
import type { Beruf, Kompetenz, SemanticEntity } from "@/lib/semantic/types";

import { chunkHash, faqHash } from "./hash";
import type { Citation, GroundedChunk, GroundedFaqItem } from "./types";

const cite = (source_id: string, source_kind: Citation["source_kind"]): Citation => ({
  source_id,
  source_kind,
  contract_version: "1.0.0",
});

const trim = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";

function answerChunk(args: {
  anchor: SemanticEntity;
  question: string;
  body: string;
  citations: ReadonlyArray<Citation>;
  snapshot_at: string;
}): GroundedChunk {
  const cleanBody = args.body.replace(/\s+/g, " ").trim();
  return {
    chunk_id: chunkHash(["faq_pair", args.anchor.id, args.question, cleanBody.toLowerCase()]),
    role: "faq_pair",
    anchor_entity_id: args.anchor.id,
    anchor_entity_kind: args.anchor.kind,
    headline: trim(args.question, 120),
    body: trim(cleanBody, 1200),
    citations: args.citations,
    snapshot_at: args.snapshot_at,
  };
}

function makeFaq(args: {
  anchor: SemanticEntity;
  question: string;
  body: string;
  citations: ReadonlyArray<Citation>;
  snapshot_at: string;
}): GroundedFaqItem {
  const q = trim(args.question, 160);
  return {
    faq_id: faqHash(q + "|" + args.anchor.id),
    question: q,
    answer: answerChunk({ ...args, question: q }),
  };
}

/* ------------------------------------------------------------------ */
/* Beruf FAQs                                                         */
/* ------------------------------------------------------------------ */

export function generateBerufFaqs(
  graph: KnowledgeGraph,
  beruf: Beruf,
): ReadonlyArray<GroundedFaqItem> {
  const out: GroundedFaqItem[] = [];
  const snap = graph.snapshot_at;

  out.push(
    makeFaq({
      anchor: beruf,
      question: `Was ist der Beruf ${beruf.name}?`,
      body:
        beruf.description ??
        `${beruf.name} ist ein anerkannter Ausbildungsberuf mit definierten Lernfeldern und Prüfungsformen.`,
      citations: [cite(beruf.id, "graph_entity")],
      snapshot_at: snap,
    }),
  );

  const scenarios = relatedExamScenarios(graph, beruf.id);
  if (scenarios.length > 0) {
    out.push(
      makeFaq({
        anchor: beruf,
        question: `Welche Prüfungen gehören zu ${beruf.name}?`,
        body:
          `Zum Beruf ${beruf.name} gehören folgende Prüfungen: ` +
          scenarios.map((p) => `${p.name} (${p.form})`).join("; ") +
          ".",
        citations: [
          cite(beruf.id, "graph_entity"),
          ...scenarios.slice(0, 5).map((p) => cite(p.id, "graph_entity")),
        ],
        snapshot_at: snap,
      }),
    );
  }

  const comps = relatedCompetencies(graph, beruf.id);
  if (comps.length > 0) {
    out.push(
      makeFaq({
        anchor: beruf,
        question: `Welche Kompetenzen werden in ${beruf.name} geprüft?`,
        body:
          `Prüfungsrelevante Kompetenzen umfassen: ` +
          comps.slice(0, 10).map((k) => k.name).join("; ") +
          ".",
        citations: [
          cite(beruf.id, "graph_entity"),
          ...comps.slice(0, 5).map((k) => cite(k.id, "graph_entity")),
        ],
        snapshot_at: snap,
      }),
    );
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Kompetenz FAQs                                                     */
/* ------------------------------------------------------------------ */

export function generateKompetenzFaqs(
  graph: KnowledgeGraph,
  kompetenz: Kompetenz,
): ReadonlyArray<GroundedFaqItem> {
  const out: GroundedFaqItem[] = [];
  const snap = graph.snapshot_at;

  out.push(
    makeFaq({
      anchor: kompetenz,
      question: `Was umfasst die Kompetenz ${kompetenz.name}?`,
      body:
        kompetenz.description ??
        `${kompetenz.name} ist eine prüfungsrelevante Kompetenz und wird über strukturierte Aufgaben geprüft.`,
      citations: [cite(kompetenz.id, "graph_entity")],
      snapshot_at: snap,
    }),
  );

  const risks = relatedRisks(graph, kompetenz.id);
  if (risks.length > 0) {
    out.push(
      makeFaq({
        anchor: kompetenz,
        question: `Welche typischen Fehler treten bei ${kompetenz.name} auf?`,
        body:
          `Typische Risiko- und Fehlermuster: ` +
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

  return out;
}

/* ------------------------------------------------------------------ */
/* Generic entry point                                                */
/* ------------------------------------------------------------------ */

export function generateFaqs(
  graph: KnowledgeGraph,
  entity: SemanticEntity,
): ReadonlyArray<GroundedFaqItem> {
  if (entity.kind === "beruf") return generateBerufFaqs(graph, entity as Beruf);
  if (entity.kind === "kompetenz") return generateKompetenzFaqs(graph, entity as Kompetenz);
  return [];
}
