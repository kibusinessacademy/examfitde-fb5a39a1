/**
 * Phase P1 — Semantic Knowledge Graph SSOT barrel.
 *
 * Single import surface for the Pillar / SRO / SEO / LLM layers.
 * Surfaces should import from `@/lib/semantic` only.
 *
 * Examiner facts (readiness, confidence, evidence, verdicts) are
 * available via `@/lib/examiner` ONLY — never re-implement them here.
 */

export * from "./types";
export * from "./KnowledgeGraph";
export * from "./resolvers";
export * from "./PillarTypes";
export * from "./pillarRoutes";
