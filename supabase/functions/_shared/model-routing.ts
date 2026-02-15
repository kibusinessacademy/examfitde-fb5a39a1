/**
 * Model Routing – Richtiges Modell für die richtige Aufgabe
 *
 * Intent-basiertes Routing mit Fallback-Kette pro Pipeline-Step.
 * 
 * Workload-Splitting nach Anforderung:
 *   ┌─────────────────────┬───────────────────────────────┬────────────────────────┐
 *   │ Workload-Typ        │ Primär                        │ Warum                  │
 *   ├─────────────────────┼───────────────────────────────┼────────────────────────┤
 *   │ Bulk MC (Exam-Pool) │ GPT-4.1-mini                  │ 1000+ Fragen, günstig  │
 *   │ Lernkurs/Handbuch   │ Claude Sonnet 4               │ Kreativität + Didaktik │
 *   │ Council/Validation  │ Claude Sonnet 4               │ Qualität > Volumen     │
 *   │ Quality Audit       │ GPT-4.1                       │ Konsistenz-Checks      │
 *   │ Tutor/Support       │ GPT-4.1-mini                  │ Schnell + günstig      │
 *   │ SEO Content         │ Claude Sonnet 4               │ Menschlicher Ton       │
 *   │ Repair (Format)     │ GPT-4.1-mini                  │ Schema-Fix, billig     │
 *   │ Repair (Didaktik)   │ Claude Sonnet 4               │ Inhalt braucht Qualität│
 *   │ Embeddings          │ text-embedding-3-large         │ Einziger Embedding-Anb.│
 *   │ Images              │ gpt-image-1                   │ Einziger Image-Anb.    │
 *   └─────────────────────┴───────────────────────────────┴────────────────────────┘
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
 * 
 * Kostenoptimiert: Bulk-Workloads → mini, Quality-Workloads → Sonnet/4.1
 */
const ROUTING_TABLE: Record<PipelineIntent, ModelChoice[]> = {
  // Kreativität + Didaktik → Claude Sonnet 4
  learning_course: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Bulk MC-Generierung: 1000+ Fragen, kein Deep Reasoning → GPT-4.1-mini (Kosteneffizienz)
  exam_questions: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Dialog + Didaktik, schnell → GPT-4.1-mini
  oral_exam: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Längere kohärente Texte → Claude Sonnet 4
  handbook: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Format-Treue, günstig → GPT-4.1-mini
  minicheck: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // SEO-Content, menschlicher Ton → Claude Sonnet 4
  seo_content: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Council: Qualität > Volumen → Claude Sonnet 4
  council_review: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Quality Audit: Konsistenz-Checks → GPT-4.1 (präzise Logik)
  quality_audit: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
  // Embeddings → OpenAI
  embeddings: [
    { provider: "openai", model: "text-embedding-3-large" },
  ],
  // Bilder → OpenAI Images
  images: [
    { provider: "openai", model: "gpt-image-1" },
  ],
  // Support/Tutor → GPT-4.1-mini (schnell + günstig)
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
  // Repair Content/Didaktik → Sonnet 4 (Qualität wichtig)
  repair_content: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Blooms Classification → GPT-4.1-mini (schnell + günstig)
  blooms_classify: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  // Curriculum Import → GPT-4.1 (Strukturerkennung)
  curriculum_import: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
};

/** Budget caps per intent (EUR per single invocation) – optimiert für mini-Modelle */
export const INTENT_BUDGETS: Record<PipelineIntent, number> = {
  learning_course: 2.5,
  exam_questions: 0.8,   // ↓ von 3.0 – mini ist 10x günstiger
  oral_exam: 0.5,        // ↓ von 2.0 – mini-basiert
  handbook: 2.0,
  minicheck: 0.3,        // ↓ von 0.5
  seo_content: 1.0,
  council_review: 0.8,
  quality_audit: 1.5,
  embeddings: 0.1,
  images: 0.5,
  support: 0.15,         // ↓ von 0.2
  summary: 0.2,          // ↓ von 0.3
  repair: 0.2,           // ↓ von 0.3
  repair_content: 1.0,
  blooms_classify: 0.15, // ↓ von 0.2
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

/**
 * Quality Escalation Rule:
 * If a cheap model (mini) produced low-quality output,
 * escalate to a higher-quality model for re-validation.
 * Returns the escalation model if score is below threshold, null otherwise.
 */
export function getEscalationModel(
  intent: PipelineIntent,
  validationScore: number,
  threshold = 70
): ModelChoice | null {
  if (validationScore >= threshold) return null;

  // Define escalation targets: mini → full model
  const escalationMap: Partial<Record<PipelineIntent, ModelChoice>> = {
    exam_questions: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    oral_exam: { provider: "openai", model: "gpt-4.1" },
    minicheck: { provider: "openai", model: "gpt-4.1" },
    support: { provider: "openai", model: "gpt-4.1" },
    summary: { provider: "openai", model: "gpt-4.1" },
    repair: { provider: "openai", model: "gpt-4.1" },
    blooms_classify: { provider: "openai", model: "gpt-4.1" },
  };

  return escalationMap[intent] || null;
}
