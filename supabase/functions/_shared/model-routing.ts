/**
 * Model Routing – Richtiges Modell für die richtige Aufgabe
 *
 * Intent-basiertes Routing mit Fallback-Kette pro Pipeline-Step.
 * 
 * Routing-Logik:
 *   Claude Sonnet 4  → SEO, Lernkurs, Council, Handbuch (Kreativität + Didaktik)
 *   GPT-4.1          → Prüfungsfragen, Oral Exam, Repair (Konsistenz + Logik)
 *   GPT-4.1-mini     → MiniChecks, Meta/FAQ, Zusammenfassungen (schnell + günstig)
 *   OpenAI Embeddings → Duplicate Detection
 *   gpt-image-1      → Bilder (Hero, SEO)
 */

import type { AIProvider } from "./ai-client.ts";

export type PipelineIntent =
  | "learning_course"
  | "exam_questions"
  | "oral_exam"
  | "handbook"
  | "minicheck"
  | "seo_content"
  | "council_review"
  | "quality_audit"
  | "embeddings"
  | "images"
  | "support"
  | "summary"
  | "repair"
  | "repair_content"
  | "blooms_classify"
  | "curriculum_import";

export interface ModelChoice {
  provider: AIProvider;
  model: string;
}

/**
 * Primary + fallback models per intent.
 * First entry = primary, rest = fallbacks in order.
 */
const ROUTING_TABLE: Record<PipelineIntent, ModelChoice[]> = {
  // Kreativität + Didaktik → Claude
  learning_course: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Konsistenz + Logik → GPT-4.1
  exam_questions: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
  // Dialog + Didaktik → GPT-4.1
  oral_exam: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
  // Längere kohärente Texte → Claude
  handbook: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Format-Treue, günstig → GPT-4.1-mini
  minicheck: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // SEO-Content, menschlicher Ton → Claude
  seo_content: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Kritik + Verbesserung → Claude
  council_review: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // IHK Quality Audit → Claude (kritischer Blick)
  quality_audit: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Embeddings → OpenAI
  embeddings: [
    { provider: "openai", model: "text-embedding-3-large" },
  ],
  // Bilder → OpenAI Images
  images: [
    { provider: "openai", model: "gpt-image-1" },
  ],
  // Support → GPT-4.1-mini primär (stabiler), DeepSeek Fallback
  support: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "deepseek", model: "deepseek-chat" },
  ],
  // Zusammenfassungen → GPT-4.1-mini
  summary: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "deepseek", model: "deepseek-chat" },
  ],
  // Repair JSON/Format → GPT-4.1-mini (billig + schnell)
  repair: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Repair Content/Didaktik → Sonnet 4
  repair_content: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Blooms Classification → GPT-4.1-mini (schnell + günstig)
  blooms_classify: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Curriculum Import → GPT-4.1
  curriculum_import: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
};

/** Budget caps per intent (EUR per single invocation) */
export const INTENT_BUDGETS: Record<PipelineIntent, number> = {
  learning_course: 2.5,
  exam_questions: 3.0,
  oral_exam: 2.0,
  handbook: 2.0,
  minicheck: 0.5,
  seo_content: 1.0,
  council_review: 0.8,
  quality_audit: 1.5,
  embeddings: 0.1,
  images: 0.5,
  support: 0.2,
  summary: 0.3,
  repair: 0.3,
  repair_content: 1.0,
  blooms_classify: 0.2,
  curriculum_import: 1.0,
};

/**
 * Get the primary model for a given intent.
 */
export function getModel(intent: PipelineIntent): ModelChoice {
  return ROUTING_TABLE[intent][0];
}

/**
 * Get primary + all fallback models for a given intent.
 */
export function getModelChain(intent: PipelineIntent): ModelChoice[] {
  return ROUTING_TABLE[intent];
}

/**
 * Get the budget cap for a given intent.
 */
export function getBudget(intent: PipelineIntent): number {
  return INTENT_BUDGETS[intent];
}
