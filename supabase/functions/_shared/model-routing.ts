/**
 * Model Routing – DB-first mit Hardcoded Fallback
 *
 * Liest Routing-Regeln aus `model_routing_rules` (TTL-Cache 60s).
 * Wenn DB leer oder nicht erreichbar → Fallback auf Hardcoded-Tabelle.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AIProvider = "openai" | "anthropic" | "google" | "deepseek";

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
  is_fallback?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  budget_cap_eur?: number;
}

// ── Hardcoded Fallback Table ──────────────────────────────────
const ROUTING_TABLE: Record<PipelineIntent, ModelChoice[]> = {
  learning_course: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  exam_questions: [
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
  oral_exam: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  handbook: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  minicheck: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  seo_content: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  council_review: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  quality_audit: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
  embeddings: [
    { provider: "openai", model: "text-embedding-3-large" },
  ],
  images: [
    { provider: "openai", model: "gpt-image-1" },
  ],
  support: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "deepseek", model: "deepseek-chat" },
  ],
  summary: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "deepseek", model: "deepseek-chat" },
  ],
  repair: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  repair_content: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  blooms_classify: [
    { provider: "openai", model: "gpt-4.1-mini" },
    { provider: "openai", model: "gpt-4.1" },
  ],
  curriculum_import: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
};

// ── Budget Caps ──────────────────────────────────────────────
export const INTENT_BUDGETS: Record<PipelineIntent, number> = {
  learning_course: 2.5,
  exam_questions: 0.8,
  oral_exam: 0.5,
  handbook: 2.0,
  minicheck: 0.3,
  seo_content: 1.0,
  council_review: 0.8,
  quality_audit: 1.5,
  embeddings: 0.1,
  images: 0.5,
  support: 0.15,
  summary: 0.2,
  repair: 0.2,
  repair_content: 1.0,
  blooms_classify: 0.15,
  curriculum_import: 1.0,
};

// ── DB-Driven Routing with TTL Cache ─────────────────────────

interface DbRule {
  intent: string;
  provider: string;
  model: string;
  priority: number;
  is_fallback: boolean;
  enabled: boolean;
  budget_cap_eur: number | null;
  max_output_tokens: number | null;
  temperature: number | null;
}

let _cache: { ts: number; byIntent: Record<string, ModelChoice[]> } | null = null;
const CACHE_TTL_MS = 60_000;

function hasServiceRole(): boolean {
  return !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") && !!Deno.env.get("SUPABASE_URL");
}

async function loadRulesFromDb(): Promise<Record<string, ModelChoice[]>> {
  if (!hasServiceRole()) return {};

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("model_routing_rules")
      .select("intent,provider,model,priority,is_fallback,enabled,budget_cap_eur,max_output_tokens,temperature")
      .eq("enabled", true)
      .order("intent", { ascending: true })
      .order("priority", { ascending: true });

    if (error || !data) {
      console.warn("[MODEL-ROUTING] DB load failed, using hardcoded:", error?.message);
      return {};
    }

    const byIntent: Record<string, ModelChoice[]> = {};
    for (const r of data as DbRule[]) {
      const step: ModelChoice = {
        provider: r.provider as AIProvider,
        model: r.model,
        is_fallback: !!r.is_fallback,
        ...(r.max_output_tokens ? { max_output_tokens: r.max_output_tokens } : {}),
        ...(typeof r.temperature === "number" ? { temperature: r.temperature } : {}),
        ...(typeof r.budget_cap_eur === "number" ? { budget_cap_eur: r.budget_cap_eur } : {}),
      };
      byIntent[r.intent] ??= [];
      byIntent[r.intent].push(step);
    }
    return byIntent;
  } catch (e) {
    console.warn("[MODEL-ROUTING] DB load exception, using hardcoded:", e);
    return {};
  }
}

async function getDbRouting(intent: string): Promise<ModelChoice[] | null> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_TTL_MS) {
    return _cache.byIntent[intent] ?? null;
  }
  const byIntent = await loadRulesFromDb();
  _cache = { ts: now, byIntent };
  return byIntent[intent] ?? null;
}

/** Invalidate the cache (e.g. after admin changes routing rules) */
export function invalidateRoutingCache(): void {
  _cache = null;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Get the primary model for a given intent.
 * DB-first, hardcoded fallback.
 */
export async function getModelAsync(intent: PipelineIntent): Promise<ModelChoice> {
  const dbPlan = await getDbRouting(intent);
  if (dbPlan && dbPlan.length > 0) return dbPlan[0];
  return ROUTING_TABLE[intent][0];
}

/**
 * Get primary + all fallback models for a given intent.
 * DB-first, hardcoded fallback.
 */
export async function getModelChainAsync(intent: PipelineIntent): Promise<ModelChoice[]> {
  const dbPlan = await getDbRouting(intent);
  if (dbPlan && dbPlan.length > 0) return dbPlan;
  return ROUTING_TABLE[intent];
}

/**
 * Synchronous access (uses hardcoded only). For backwards compatibility.
 */
export function getModel(intent: PipelineIntent): ModelChoice {
  return ROUTING_TABLE[intent][0];
}

export function getModelChain(intent: PipelineIntent): ModelChoice[] {
  return ROUTING_TABLE[intent];
}

export function getBudget(intent: PipelineIntent): number {
  return INTENT_BUDGETS[intent];
}

// ── Adaptive Quality Escalation ──────────────────────────────

export type ContentDifficulty = "easy" | "medium" | "hard" | "very_hard";
export type QuestionType = "single_choice" | "multiple_choice" | "calculation" | "case_study" | "oral" | "other";

const DIFFICULTY_THRESHOLDS: Record<ContentDifficulty, number> = {
  easy: 60, medium: 70, hard: 75, very_hard: 80,
};

const TYPE_MODIFIERS: Record<QuestionType, number> = {
  single_choice: 0, multiple_choice: 2, calculation: 3, case_study: 5, oral: 5, other: 0,
};

export function getAdaptiveThreshold(
  difficulty: ContentDifficulty = "medium",
  questionType: QuestionType = "single_choice"
): number {
  return DIFFICULTY_THRESHOLDS[difficulty] + TYPE_MODIFIERS[questionType];
}

export function getEscalationModel(
  intent: PipelineIntent,
  validationScore: number,
  opts?: { difficulty?: ContentDifficulty; questionType?: QuestionType; threshold?: number }
): ModelChoice | null {
  const threshold = opts?.threshold ??
    getAdaptiveThreshold(opts?.difficulty ?? "medium", opts?.questionType ?? "single_choice");

  if (validationScore >= threshold) return null;

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
