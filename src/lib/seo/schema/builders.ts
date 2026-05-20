/**
 * Phase P3 — Schema.org builders (pure, deterministic).
 *
 * Every builder consumes already-grounded data (entities from the P1
 * graph or chunks from the P2 grounding layer) and emits a JSON-LD
 * object. No I/O. No randomness. No AI calls.
 *
 * Builders DO NOT inject readiness/confidence/verdict values — those
 * must arrive verbatim from the Examiner Handover via the grounding
 * layer.
 */

import type { GroundedChunk, GroundedFaqItem } from "@/lib/llm-grounding";
import type { Beruf, Kompetenz, Pruefung, SemanticEntity } from "@/lib/semantic/types";

import { SCHEMA_CONTEXT, type JsonLdObject, type SchemaBuilderContext } from "./types";

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as T;
}

function normUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function entityUrl(ctx: SchemaBuilderContext, kind: string, key: string): string {
  return normUrl(ctx.baseUrl, `/wissen/${kind}/${encodeURIComponent(key)}`);
}

/* ------------------------------------------------------------------ */
/* BreadcrumbList                                                     */
/* ------------------------------------------------------------------ */

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function buildBreadcrumbList(items: ReadonlyArray<BreadcrumbItem>): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, idx) =>
      stripUndefined({
        "@type": "ListItem",
        position: idx + 1,
        name: it.name,
        item: it.url,
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* FAQPage                                                            */
/* ------------------------------------------------------------------ */

export function buildFAQPage(faqs: ReadonlyArray<GroundedFaqItem>): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity: faqs.map((f) =>
      stripUndefined({
        "@type": "Question",
        "@id": `#${f.faq_id}`,
        name: f.question,
        acceptedAnswer: stripUndefined({
          "@type": "Answer",
          "@id": `#${f.answer.chunk_id}`,
          text: f.answer.body,
        }),
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* QAPage (single, examiner-grounded Q&A surface)                     */
/* ------------------------------------------------------------------ */

export function buildQAPage(args: {
  url: string;
  question: string;
  answer: GroundedChunk;
}): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "QAPage",
    "@id": args.url,
    mainEntity: stripUndefined({
      "@type": "Question",
      name: args.question,
      acceptedAnswer: stripUndefined({
        "@type": "Answer",
        "@id": `#${args.answer.chunk_id}`,
        text: args.answer.body,
      }),
    }),
  };
}

/* ------------------------------------------------------------------ */
/* DefinedTerm (for a Kompetenz)                                      */
/* ------------------------------------------------------------------ */

export function buildDefinedTerm(
  ctx: SchemaBuilderContext,
  k: Kompetenz,
  termSetUrl?: string,
): JsonLdObject {
  return stripUndefined({
    "@context": SCHEMA_CONTEXT,
    "@type": "DefinedTerm",
    "@id": entityUrl(ctx, "kompetenz", k.key),
    name: k.name,
    description: k.description,
    termCode: k.key,
    inDefinedTermSet: termSetUrl,
  });
}

/** A DefinedTermSet that groups all competencies of a Beruf / Lernfeld. */
export function buildDefinedTermSet(args: {
  id: string;
  name: string;
  terms: ReadonlyArray<JsonLdObject>;
}): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "DefinedTermSet",
    "@id": args.id,
    name: args.name,
    hasDefinedTerm: args.terms,
  };
}

/* ------------------------------------------------------------------ */
/* Course (for a Beruf / Pruefung)                                    */
/* ------------------------------------------------------------------ */

export interface ProviderRef {
  name: string;
  url: string;
}

export function buildCourse(
  ctx: SchemaBuilderContext,
  beruf: Beruf,
  provider: ProviderRef,
  about?: ReadonlyArray<Kompetenz>,
): JsonLdObject {
  return stripUndefined({
    "@context": SCHEMA_CONTEXT,
    "@type": "Course",
    "@id": entityUrl(ctx, "beruf", beruf.key),
    name: beruf.name,
    description: beruf.description,
    provider: stripUndefined({
      "@type": "Organization",
      name: provider.name,
      url: provider.url,
    }),
    about: about?.map((k) =>
      stripUndefined({
        "@type": "DefinedTerm",
        name: k.name,
        termCode: k.key,
      }),
    ),
  });
}

/** EducationEvent for a specific Pruefung (form + schedule semantics). */
export function buildEducationEvent(
  ctx: SchemaBuilderContext,
  p: Pruefung,
  parent: Beruf,
): JsonLdObject {
  return stripUndefined({
    "@context": SCHEMA_CONTEXT,
    "@type": "EducationEvent",
    "@id": entityUrl(ctx, "pruefung", p.key),
    name: p.name,
    description: p.description,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    about: stripUndefined({
      "@type": "Course",
      name: parent.name,
      "@id": entityUrl(ctx, "beruf", parent.key),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* @graph composer                                                    */
/* ------------------------------------------------------------------ */

/**
 * Compose multiple builder outputs into a single JSON-LD @graph
 * document with a stable, sorted node order (by `@id` then `@type`).
 */
export function composeSchemaGraph(nodes: ReadonlyArray<JsonLdObject>): JsonLdObject {
  // Strip the inner @context so the wrapper owns it.
  const stripped = nodes.map(({ "@context": _ctx, ...rest }) => rest as JsonLdObject);
  const sorted = [...stripped].sort((a, b) => {
    const ai = String(a["@id"] ?? "");
    const bi = String(b["@id"] ?? "");
    if (ai !== bi) return ai.localeCompare(bi);
    return String(a["@type"]).localeCompare(String(b["@type"]));
  });
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Dataset",
    "@graph": sorted,
  } as JsonLdObject;
}

/* ------------------------------------------------------------------ */
/* Generic guard helpers                                              */
/* ------------------------------------------------------------------ */

export function isSchemaObject(value: unknown): value is JsonLdObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "@type" in (value as Record<string, unknown>)
  );
}

/** Anchor an arbitrary entity into a `WebPage` node — for Pillar/Satellite. */
export function buildWebPageAnchor(
  ctx: SchemaBuilderContext,
  entity: SemanticEntity,
  opts?: { breadcrumbs?: BreadcrumbItem[]; about?: string },
): JsonLdObject {
  const url = entityUrl(ctx, entity.kind, entity.key);
  return stripUndefined({
    "@context": SCHEMA_CONTEXT,
    "@type": "WebPage",
    "@id": url,
    url,
    name: entity.name,
    description: entity.description,
    about: opts?.about,
    breadcrumb: opts?.breadcrumbs ? buildBreadcrumbList(opts.breadcrumbs) : undefined,
    dateModified: ctx.snapshot_at,
  });
}
