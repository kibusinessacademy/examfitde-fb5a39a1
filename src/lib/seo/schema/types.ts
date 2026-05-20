/**
 * Phase P3 — Schema.org / JSON-LD SSOT (types).
 *
 * Deterministic, retrieval-friendly Schema.org builders for Pillar /
 * Satellite pages. All builders are pure functions over the P1
 * Knowledge Graph + P2 LLM-Grounding output. They NEVER recompute
 * examiner facts.
 *
 * Hard rule (enforced by `scripts/guards/seo-schema-ssot.mjs`):
 *   New JSON-LD must be produced via these builders. Hand-rolled
 *   `"@type": "..."` strings outside the SSOT layer are blocked.
 */

export const SCHEMA_CONTEXT = "https://schema.org" as const;

export type JsonLdScalar = string | number | boolean | null;
export type JsonLdValue = JsonLdScalar | JsonLdObject | JsonLdArray;
export interface JsonLdObject {
  readonly "@context"?: typeof SCHEMA_CONTEXT;
  readonly "@type": string | ReadonlyArray<string>;
  readonly "@id"?: string;
  readonly [key: string]: JsonLdValue | undefined;
}
export type JsonLdArray = ReadonlyArray<JsonLdValue>;

export interface SchemaBuilderContext {
  /** Absolute base URL (e.g. https://examfitde.lovable.app). No trailing slash. */
  baseUrl: string;
  /** ISO-8601 snapshot timestamp (must match graph snapshot). */
  snapshot_at: string;
}

/** Contract version this schema layer is bound to. */
export const SCHEMA_LAYER_VERSION = "1.0.0" as const;
