/**
 * batch/enqueue.ts — Helper to enqueue requests for batch API (provider-agnostic).
 *
 * Collects batch requests into llm_batch_requests via batch-submit,
 * or can directly invoke batch-submit for immediate submission.
 * Provider is auto-detected from the model via providerForModel().
 */

import type { NormalizedBatchRequest } from "./types.ts";
import { buildBatchChatRequest } from "./routing-config.ts";
import { providerForModel } from "../model-catalog.ts";

export interface BatchRequestItem {
  /** Unique correlation ID for this request */
  customId: string;
  /** Source job ID from job_queue */
  sourceJobId?: string | null;
  /** Source reference data (e.g. lesson_id, blueprint_id) */
  sourceRef?: Record<string, unknown> | null;
  /** Link back to ai_generation_requests */
  aiGenerationRequestId?: string | null;
  /** Job type for routing in the importer */
  jobType: string;
  /** Model to use */
  model: string;
  /** Chat messages */
  messages: Array<{ role: string; content: string }>;
  /** Temperature */
  temperature?: number;
  /** Max tokens */
  maxTokens?: number;
}

/**
 * Build NormalizedBatchRequest[] for submission to batch-submit.
 */
export function buildBatchRequests(
  items: BatchRequestItem[],
): NormalizedBatchRequest[] {
  return items.map((item) => ({
    custom_id: item.customId,
    source_job_id: item.sourceJobId || null,
    source_ref: item.sourceRef as any,
    ai_generation_request_id: item.aiGenerationRequestId || null,
    job_type: item.jobType,
    model: item.model,
    endpoint: "/v1/chat/completions",
    request_payload: buildBatchChatRequest(item.model, item.messages, {
      temperature: item.temperature,
      max_tokens: item.maxTokens,
    }),
  }));
}

/**
 * Submit a batch of requests via the batch-submit edge function.
 * Returns the batch ID for tracking.
 */
export async function submitBatchViaFunction(
  supabaseUrl: string,
  serviceRoleKey: string,
  opts: {
    jobType: string;
    model: string;
    requests: NormalizedBatchRequest[];
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; batchId?: string; error?: string }> {
  try {
    // Auto-detect provider from model to prevent mismatch
    const detectedProvider = providerForModel(opts.model);

    // OpenAI requires ALL metadata values to be strings
    const sanitizedMetadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.metadata || {})) {
      sanitizedMetadata[k] = String(v ?? "");
    }
    
    const resp = await fetch(`${supabaseUrl}/functions/v1/batch-submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        provider: detectedProvider,
        model: opts.model,
        endpoint: "/v1/chat/completions",
        job_type: opts.jobType,
        requests: opts.requests,
        metadata: sanitizedMetadata,
      }),
    });

    const result = await resp.json();
    if (!resp.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${resp.status}` };
    }
    return { ok: true, batchId: result.batch_id };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}
