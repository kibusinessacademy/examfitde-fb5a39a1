/**
 * enqueueBatchRequest — Helper to defer an LLM call to Anthropic Batch API
 *
 * Instead of calling callAIWithFailover synchronously, edge functions
 * can call this to queue the request for batch processing (50% discount).
 *
 * The batch-submit cron will pick it up and submit to Anthropic.
 * The batch-poll cron will process results back into the pipeline.
 */

import { toBatchRequestItem, BATCH_DEFAULT_MODEL, BATCH_ELIGIBLE_JOB_TYPES } from "./anthropic-batch.ts";

export interface BatchEnqueueOpts {
  /** Supabase client with service role */
  sb: { from: (table: string) => any };
  /** Unique correlation ID (usually job_id or composite) */
  customId: string;
  /** Original job_queue ID */
  jobId?: string;
  /** Job type for tracking */
  jobType: string;
  /** Package ID for correlation */
  packageId?: string;
  /** Pipeline intent */
  intent?: string;
  /** Priority (higher = processed sooner) */
  priority?: number;
  /** Model to use */
  model?: string;
  /** Messages in callAI format */
  messages: Array<{ role: string; content: string }>;
  /** Generation params */
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
  toolChoice?: any;
}

/**
 * Check if a job type is eligible for batch processing.
 */
export function isBatchEligible(jobType: string): boolean {
  return BATCH_ELIGIBLE_JOB_TYPES.has(jobType);
}

/**
 * Enqueue a request for Anthropic batch processing.
 * Returns the DB row ID for tracking.
 */
export async function enqueueBatchRequest(opts: BatchEnqueueOpts): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
}> {
  const model = opts.model || BATCH_DEFAULT_MODEL;

  // Build Anthropic-format request params
  const batchItem = toBatchRequestItem(opts.customId, opts.messages, {
    model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    tools: opts.tools,
    tool_choice: opts.toolChoice,
  });

  const { data, error } = await opts.sb
    .from("anthropic_batch_requests")
    .insert({
      custom_id: opts.customId,
      job_id: opts.jobId || null,
      job_type: opts.jobType,
      package_id: opts.packageId || null,
      request_params: batchItem.params,
      model,
      intent: opts.intent || null,
      priority: opts.priority || 5,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[batch-enqueue] Insert failed: ${error.message}`);
    return { ok: false, error: error.message };
  }

  console.log(`[batch-enqueue] Queued ${opts.jobType} (${opts.customId}) for batch processing`);
  return { ok: true, id: data?.id };
}
