/**
 * Phase P2 — LLM-Grounding Layer barrel.
 *
 * Single import surface for retrieval-first, citation-bound chunk
 * generation. Consumers (SRO, SEO authority pages, LLM grounding feeds)
 * import only from `@/lib/llm-grounding`.
 *
 * NEVER recomputes examiner facts. NEVER produces generative copy.
 * Output is byte-stable for identical input.
 */

export * from "./types";
export * from "./hash";
export * from "./contract";
export * from "./serializers";
export * from "./ExaminerEvidenceSerializer";
export * from "./FaqGenerator";
export * from "./DocumentBuilder";
