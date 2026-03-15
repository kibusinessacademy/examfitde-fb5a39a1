/**
 * Anthropic Batch API — Shared utilities
 *
 * Converts callAI-compatible params to Anthropic Batch format
 * and handles result parsing back into our pipeline format.
 *
 * Batch API gives 50% discount on all Anthropic models.
 * Docs: https://docs.anthropic.com/en/docs/build-with-claude/batch-processing
 */

import { estimateCostEur } from "./token-estimator.ts";

// ── Types ────────────────────────────────────────────────────

export interface BatchRequestItem {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    messages: Array<{ role: string; content: string }>;
    system?: string | Array<{ type: string; text: string; cache_control?: { type: string } }>;
    temperature?: number;
    tools?: any[];
    tool_choice?: any;
  };
}

export interface BatchResultItem {
  custom_id: string;
  result: {
    type: "succeeded" | "errored" | "expired" | "cancelled";
    message?: {
      id: string;
      content: Array<{ type: string; text?: string; name?: string; input?: any }>;
      model: string;
      stop_reason: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    error?: {
      type: string;
      message: string;
    };
  };
}

// ── Batch-eligible intents ───────────────────────────────────
// These pipeline intents can be deferred to batch processing
// (non-realtime, no user waiting)

export const BATCH_ELIGIBLE_INTENTS = new Set([
  "learning_content",
  "exam_questions",
  "handbook",
  "seo_content",
  "quality_audit",
  "curriculum_import",
  "repair_content",
  "minicheck",
  "council_review",
  "council_proposer",
  "council_validator",
  "blooms_classify",
  "summary",
]);

// Job types that can be batch-routed
export const BATCH_ELIGIBLE_JOB_TYPES = new Set([
  "package_generate_learning_content",
  "lesson_generate_content",
  "lesson_generate_competency_bundle",
  "package_generate_handbook",
  "handbook_expand_section",
  "package_generate_exam_pool",
  "package_generate_oral_exam",
  "package_generate_lesson_minichecks",
  "package_generate_glossary",
  "mass_enrich_competencies_v2",
  "pool_fill_lf_gaps",
  "pool_fill_bloom_gaps",
]);

export const BATCH_DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const BATCH_API_URL = "https://api.anthropic.com/v1/messages/batches";
export const BATCH_DISCOUNT = 0.5; // 50% off

// ── Conversion helpers ───────────────────────────────────────

/**
 * Convert callAI-compatible messages into an Anthropic Batch request item.
 */
export function toBatchRequestItem(
  customId: string,
  messages: Array<{ role: string; content: string }>,
  opts: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    tools?: any[];
    tool_choice?: any;
  } = {},
): BatchRequestItem {
  const model = opts.model || BATCH_DEFAULT_MODEL;
  const maxTokens = opts.max_tokens || 4096;

  // Separate system message (Anthropic format)
  const systemMsg = messages.find(m => m.role === "system");
  const nonSystemMsgs = messages.filter(m => m.role !== "system");

  const params: BatchRequestItem["params"] = {
    model,
    max_tokens: maxTokens,
    messages: nonSystemMsgs,
  };

  // Prompt caching for system prompts ≥1024 tokens
  if (systemMsg) {
    const tokenEstimate = Math.ceil(systemMsg.content.length / 4);
    if (tokenEstimate >= 1024) {
      params.system = [{
        type: "text",
        text: systemMsg.content,
        cache_control: { type: "ephemeral" },
      }];
    } else {
      params.system = systemMsg.content;
    }
  }

  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.tools) {
    params.tools = opts.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
  if (opts.tool_choice) {
    const fnName = opts.tool_choice?.function?.name;
    if (fnName) params.tool_choice = { type: "tool", name: fnName };
  }

  return { custom_id: customId, params };
}

/**
 * Parse a batch result item into our standard format.
 */
export function parseBatchResult(item: BatchResultItem): {
  ok: boolean;
  content: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }>;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  stop_reason?: string;
  error?: string;
  cost_eur: number;
  model: string;
} {
  if (item.result.type !== "succeeded" || !item.result.message) {
    return {
      ok: false,
      content: "",
      error: item.result.error?.message || `Batch item ${item.result.type}`,
      cost_eur: 0,
      model: BATCH_DEFAULT_MODEL,
    };
  }

  const msg = item.result.message;
  const textBlock = msg.content.find(b => b.type === "text");
  const toolBlock = msg.content.find(b => b.type === "tool_use");
  const content = textBlock?.text || "";

  const usage = msg.usage;
  // Apply 50% batch discount to cost
  const baseCost = estimateCostEur(msg.model, usage.input_tokens, usage.output_tokens);
  const batchCost = baseCost * BATCH_DISCOUNT;

  return {
    ok: true,
    content,
    toolCalls: toolBlock ? [{
      function: {
        name: toolBlock.name!,
        arguments: JSON.stringify(toolBlock.input),
      },
    }] : undefined,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    },
    stop_reason: msg.stop_reason,
    cost_eur: batchCost,
    model: msg.model,
  };
}

/**
 * Submit a batch to Anthropic's Batch API.
 */
export async function submitBatch(
  requests: BatchRequestItem[],
  apiKey: string,
): Promise<{ batch_id: string; request_count: number; expires_at: string }> {
  const resp = await fetch(BATCH_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Batch submit failed: HTTP ${resp.status} — ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  return {
    batch_id: data.id,
    request_count: requests.length,
    expires_at: data.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Check batch status.
 */
export async function getBatchStatus(
  batchId: string,
  apiKey: string,
): Promise<{
  id: string;
  status: string; // "in_progress" | "ended" | "expired" | "canceling" | "canceled"
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  ended_at?: string;
  expires_at?: string;
  results_url?: string;
}> {
  const resp = await fetch(`${BATCH_API_URL}/${batchId}`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
    },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Batch status check failed: HTTP ${resp.status} — ${errText.slice(0, 200)}`);
  }

  return await resp.json();
}

/**
 * Fetch batch results (JSONL stream).
 */
export async function fetchBatchResults(
  resultsUrl: string,
  apiKey: string,
): Promise<BatchResultItem[]> {
  const resp = await fetch(resultsUrl, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "message-batches-2024-09-24",
    },
  });

  if (!resp.ok) {
    throw new Error(`Batch results fetch failed: HTTP ${resp.status}`);
  }

  const text = await resp.text();
  const items: BatchResultItem[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {
      console.warn(`[BATCH] Skipping unparseable result line: ${trimmed.slice(0, 100)}`);
    }
  }
  return items;
}
