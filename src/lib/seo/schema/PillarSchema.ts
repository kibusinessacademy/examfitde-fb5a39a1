/**
 * Phase P3 — Pillar & Satellite schema composers.
 *
 * Take a Knowledge Graph entity (Pillar) + its grounded chunks + FAQs
 * and emit a single JSON-LD `@graph` document with WebPage + Course /
 * EducationEvent + DefinedTermSet + FAQPage + BreadcrumbList nodes.
 *
 * Determinism: identical input ⇒ identical output (P3 contract).
 */

import { generateFaqs } from "@/lib/llm-grounding";
import type { KnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import { relatedExamScenarios } from "@/lib/semantic/resolvers";
import type { Beruf, Kompetenz, Lernfeld, Pruefung, SemanticEntity } from "@/lib/semantic/types";

/** Gather kompetenzen of a Beruf via its lernfelder (P1 traversal). */
function competenciesOfBeruf(graph: KnowledgeGraph, beruf: Beruf): ReadonlyArray<Kompetenz> {
  const out = new Map<string, Kompetenz>();
  const lfs = graph
    .resolveTargets(graph.outgoingEdges(beruf.id, "beruf_has_lernfeld"))
    .filter((e): e is Lernfeld => e.kind === "lernfeld");
  for (const lf of lfs) {
    const ks = graph
      .resolveTargets(graph.outgoingEdges(lf.id, "lernfeld_has_kompetenz"))
      .filter((e): e is Kompetenz => e.kind === "kompetenz");
    for (const k of ks) if (!out.has(k.id)) out.set(k.id, k);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

import {
  buildBreadcrumbList,
  buildCourse,
  buildDefinedTerm,
  buildDefinedTermSet,
  buildEducationEvent,
  buildFAQPage,
  buildWebPageAnchor,
  composeSchemaGraph,
  type BreadcrumbItem,
  type ProviderRef,
} from "./builders";
import type { JsonLdObject, SchemaBuilderContext } from "./types";

export interface PillarSchemaOptions {
  provider: ProviderRef;
  breadcrumbs?: BreadcrumbItem[];
}

/* ------------------------------------------------------------------ */
/* Pillar (Beruf)                                                     */
/* ------------------------------------------------------------------ */

export function buildBerufPillarSchema(
  graph: KnowledgeGraph,
  ctx: SchemaBuilderContext,
  beruf: Beruf,
  opts: PillarSchemaOptions,
): JsonLdObject {
  const comps = competenciesOfBeruf(graph, beruf);
  const scenarios = relatedExamScenarios(graph, beruf.id);
  const faqs = generateFaqs(graph, beruf);

  const nodes: JsonLdObject[] = [
    buildWebPageAnchor(ctx, beruf, {
      breadcrumbs: opts.breadcrumbs,
      about: beruf.name,
    }),
    buildCourse(ctx, beruf, opts.provider, comps),
  ];

  if (comps.length > 0) {
    const terms = comps.map((k) => buildDefinedTerm(ctx, k));
    nodes.push(
      buildDefinedTermSet({
        id: `${ctx.baseUrl}/wissen/beruf/${encodeURIComponent(beruf.key)}#kompetenzen`,
        name: `Kompetenzen ${beruf.name}`,
        terms,
      }),
    );
  }

  for (const p of scenarios) nodes.push(buildEducationEvent(ctx, p, beruf));

  if (faqs.length > 0) nodes.push(buildFAQPage(faqs));

  if (opts.breadcrumbs && opts.breadcrumbs.length > 0) {
    nodes.push(buildBreadcrumbList(opts.breadcrumbs));
  }

  return composeSchemaGraph(nodes);
}

/* ------------------------------------------------------------------ */
/* Satellite (Kompetenz)                                              */
/* ------------------------------------------------------------------ */

export function buildKompetenzSatelliteSchema(
  graph: KnowledgeGraph,
  ctx: SchemaBuilderContext,
  kompetenz: Kompetenz,
  opts: PillarSchemaOptions,
): JsonLdObject {
  const faqs = generateFaqs(graph, kompetenz);

  const nodes: JsonLdObject[] = [
    buildWebPageAnchor(ctx, kompetenz, {
      breadcrumbs: opts.breadcrumbs,
      about: kompetenz.name,
    }),
    buildDefinedTerm(ctx, kompetenz),
  ];

  if (faqs.length > 0) nodes.push(buildFAQPage(faqs));
  if (opts.breadcrumbs && opts.breadcrumbs.length > 0) {
    nodes.push(buildBreadcrumbList(opts.breadcrumbs));
  }

  return composeSchemaGraph(nodes);
}

/* ------------------------------------------------------------------ */
/* Satellite (Pruefung)                                               */
/* ------------------------------------------------------------------ */

export function buildPruefungSatelliteSchema(
  graph: KnowledgeGraph,
  ctx: SchemaBuilderContext,
  pruefung: Pruefung,
  opts: PillarSchemaOptions,
): JsonLdObject {
  const parent = graph.getEntity(pruefung.beruf_id) as Beruf | undefined;
  const nodes: JsonLdObject[] = [buildWebPageAnchor(ctx, pruefung, { breadcrumbs: opts.breadcrumbs })];
  if (parent && parent.kind === "beruf") {
    nodes.push(buildEducationEvent(ctx, pruefung, parent));
  }
  if (opts.breadcrumbs && opts.breadcrumbs.length > 0) {
    nodes.push(buildBreadcrumbList(opts.breadcrumbs));
  }
  return composeSchemaGraph(nodes);
}

/* ------------------------------------------------------------------ */
/* Generic dispatch                                                   */
/* ------------------------------------------------------------------ */

export function buildEntitySchema(
  graph: KnowledgeGraph,
  ctx: SchemaBuilderContext,
  entity: SemanticEntity,
  opts: PillarSchemaOptions,
): JsonLdObject {
  if (entity.kind === "beruf") return buildBerufPillarSchema(graph, ctx, entity as Beruf, opts);
  if (entity.kind === "kompetenz") return buildKompetenzSatelliteSchema(graph, ctx, entity as Kompetenz, opts);
  if (entity.kind === "pruefung") return buildPruefungSatelliteSchema(graph, ctx, entity as Pruefung, opts);
  return composeSchemaGraph([buildWebPageAnchor(ctx, entity, { breadcrumbs: opts.breadcrumbs })]);
}

/** Serialize for `<script type="application/ld+json">`. Stable formatting. */
export function serializeSchema(node: JsonLdObject): string {
  return JSON.stringify(node);
}
