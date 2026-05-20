/**
 * Phase P3 — Schema.org SSOT barrel.
 *
 * Single import surface for JSON-LD generation. Surfaces (React pages,
 * SSR scripts, sitemap+head injectors) import only from `@/lib/seo/schema`.
 *
 * Manual `application/ld+json` strings outside this layer are blocked
 * by `scripts/guards/seo-schema-ssot.mjs` (baseline-waivers in
 * `seo-schema-ssot.baseline.json`).
 */

export * from "./types";
export * from "./builders";
export * from "./PillarSchema";
export * from "./contract";
