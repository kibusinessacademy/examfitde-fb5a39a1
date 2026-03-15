/**
 * Helper to build normalized batch request payloads for OpenAI chat completions.
 */
import type { NormalizedBatchRequest } from "./types.ts";

export interface BuildChatCompletionArgs {
  customId: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: Record<string, unknown> | null;
  sourceJobId?: string | null;
  sourceTable?: string | null;
  sourceRef?: Record<string, unknown> | null;
  jobType: string;
}

export function buildOpenAIChatRequest(
  args: BuildChatCompletionArgs,
): NormalizedBatchRequest {
  const payload: Record<string, unknown> = {
    model: args.model,
    temperature: args.temperature ?? 0.2,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  };

  if (args.maxTokens) payload.max_tokens = args.maxTokens;
  if (args.responseFormat) payload.response_format = args.responseFormat;

  return {
    custom_id: args.customId,
    source_job_id: args.sourceJobId ?? null,
    source_table: args.sourceTable ?? null,
    source_ref: args.sourceRef ?? null,
    job_type: args.jobType,
    model: args.model,
    endpoint: "/v1/chat/completions",
    request_payload: payload,
  };
}
