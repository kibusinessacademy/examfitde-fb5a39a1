/**
 * Provider-agnostic Batch API types.
 * OpenAI first, Anthropic adapter follows in Phase C.
 */

export type BatchProvider = "openai" | "anthropic";

export type BatchStatus =
  | "draft"
  | "uploading"
  | "uploaded"
  | "submitted"
  | "validating"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

export interface NormalizedBatchRequest {
  custom_id: string;
  source_job_id?: string | null;
  source_table?: string | null;
  source_ref?: Record<string, unknown> | null;
  ai_generation_request_id?: string | null;
  job_type: string;
  model: string;
  endpoint: string;
  request_payload: Record<string, unknown>;
}

export interface BatchCreateInput {
  provider: BatchProvider;
  model: string;
  endpoint: string;
  completion_window?: "24h";
  metadata?: Record<string, unknown>;
  requests: NormalizedBatchRequest[];
}

export interface BatchSubmitResult {
  provider: BatchProvider;
  provider_batch_id: string;
  input_file_id?: string | null;
  output_file_id?: string | null;
  error_file_id?: string | null;
  status: BatchStatus;
  request_count: number;
  raw: Record<string, unknown>;
}

export interface BatchPollResult {
  provider: BatchProvider;
  provider_batch_id: string;
  status: BatchStatus;
  output_file_id?: string | null;
  error_file_id?: string | null;
  request_counts?: {
    total?: number;
    completed?: number;
    failed?: number;
  };
  raw: Record<string, unknown>;
}

export interface ParsedBatchOutputRow {
  custom_id: string;
  response_http_status?: number | null;
  response_body?: Record<string, unknown> | null;
  error_body?: Record<string, unknown> | null;
  usage_data?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_input_tokens?: number;
  } | null;
  raw: Record<string, unknown>;
}

export interface BatchProviderAdapter {
  submit(input: BatchCreateInput): Promise<BatchSubmitResult>;
  poll(providerBatchId: string): Promise<BatchPollResult>;
  downloadOutput(fileId: string): Promise<string>;
  parseOutputJsonl(content: string): ParsedBatchOutputRow[];
  /** Separate error file parser — more defensive than output parser */
  parseErrorJsonl(content: string): ParsedBatchOutputRow[];
}
