/**
 * OpenAI Batch API adapter — hardened.
 * JSONL build → File upload (with 200MB guard) → Batch create → Poll → Download + parse.
 */
import type {
  BatchCreateInput,
  BatchPollResult,
  BatchProviderAdapter,
  BatchSubmitResult,
  BatchStatus,
  ParsedBatchOutputRow,
} from "./types.ts";

const OPENAI_BASE_URL =
  Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";

const MAX_INPUT_BYTES = 200 * 1024 * 1024; // 200 MB OpenAI limit

function getApiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY secret not configured");
  return key;
}

function mapStatus(s: string): BatchStatus {
  const map: Record<string, BatchStatus> = {
    validating: "validating",
    in_progress: "in_progress",
    finalizing: "finalizing",
    completed: "completed",
    failed: "failed",
    expired: "expired",
    cancelled: "cancelled",
    cancelling: "cancelled",
  };
  return map[s] ?? "submitted";
}

function toJsonl(input: BatchCreateInput): string {
  return input.requests
    .map((r) =>
      JSON.stringify({
        custom_id: r.custom_id,
        method: "POST",
        url: input.endpoint,
        body: r.request_payload,
      })
    )
    .join("\n");
}

async function uploadFile(
  jsonl: string,
): Promise<{ id: string; bytes: number; raw: Record<string, unknown> }> {
  const key = getApiKey();

  // Fix #6: 200 MB guard
  const bytes = new TextEncoder().encode(jsonl).byteLength;
  if (bytes > MAX_INPUT_BYTES) {
    throw new Error(
      `Batch input exceeds 200 MB limit (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
    );
  }

  const form = new FormData();
  form.append("purpose", "batch");
  form.append(
    "file",
    new Blob([jsonl], { type: "application/jsonl" }),
    "batch-input.jsonl",
  );

  const res = await fetch(`${OPENAI_BASE_URL}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const raw = await res.json();
  if (!res.ok) throw new Error(`OpenAI file upload failed: ${JSON.stringify(raw)}`);
  return { id: raw.id, bytes, raw };
}

export const openAIBatchAdapter: BatchProviderAdapter = {
  async submit(input: BatchCreateInput): Promise<BatchSubmitResult> {
    if (input.provider !== "openai")
      throw new Error("openAIBatchAdapter only supports provider=openai");

    const key = getApiKey();
    const jsonl = toJsonl(input);
    const upload = await uploadFile(jsonl);

    const res = await fetch(`${OPENAI_BASE_URL}/batches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input_file_id: upload.id,
        endpoint: input.endpoint,
        completion_window: input.completion_window || "24h",
        metadata: input.metadata || {},
      }),
    });

    const raw = await res.json();
    if (!res.ok)
      throw new Error(`OpenAI batch create failed: ${JSON.stringify(raw)}`);

    return {
      provider: "openai",
      provider_batch_id: raw.id,
      input_file_id: raw.input_file_id ?? upload.id,
      output_file_id: raw.output_file_id ?? null,
      error_file_id: raw.error_file_id ?? null,
      status: mapStatus(raw.status),
      request_count: input.requests.length,
      raw: { ...raw, input_bytes: upload.bytes },
    };
  },

  async poll(providerBatchId: string): Promise<BatchPollResult> {
    const key = getApiKey();
    const res = await fetch(
      `${OPENAI_BASE_URL}/batches/${providerBatchId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      },
    );

    const raw = await res.json();
    if (!res.ok)
      throw new Error(`OpenAI batch poll failed: ${JSON.stringify(raw)}`);

    return {
      provider: "openai",
      provider_batch_id: raw.id,
      status: mapStatus(raw.status),
      output_file_id: raw.output_file_id ?? null,
      error_file_id: raw.error_file_id ?? null,
      request_counts: raw.request_counts
        ? {
            total: raw.request_counts.total,
            completed: raw.request_counts.completed,
            failed: raw.request_counts.failed,
          }
        : undefined,
      raw,
    };
  },

  async downloadOutput(fileId: string): Promise<string> {
    const key = getApiKey();
    const res = await fetch(`${OPENAI_BASE_URL}/files/${fileId}/content`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });

    const text = await res.text();
    if (!res.ok)
      throw new Error(`OpenAI file download failed: ${text.slice(0, 500)}`);
    return text;
  },

  parseOutputJsonl(content: string): ParsedBatchOutputRow[] {
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          console.warn("[openai-batch] Skipping unparseable JSONL line");
          return null;
        }
      })
      .filter(Boolean)
      .map((row: any) => {
        const body = row.response?.body ?? null;
        const usage = body?.usage ?? null;
        // Fix #4: robust success check
        const httpStatus = row.response?.status_code ?? null;
        return {
          custom_id: row.custom_id,
          response_http_status: httpStatus,
          response_body: body,
          error_body: row.error ?? null,
          usage_data: usage
            ? {
                input_tokens:
                  usage.input_tokens ?? usage.prompt_tokens ?? null,
                output_tokens:
                  usage.output_tokens ?? usage.completion_tokens ?? null,
                total_tokens: usage.total_tokens ?? null,
                cached_input_tokens:
                  usage.input_tokens_details?.cached_tokens ??
                  usage.prompt_tokens_details?.cached_tokens ??
                  null,
              }
            : null,
          raw: row,
        };
      });
  },

  /** Fix #3: Separate error file parser — more defensive */
  parseErrorJsonl(content: string): ParsedBatchOutputRow[] {
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          const row = JSON.parse(line);
          return {
            custom_id: row.custom_id,
            response_http_status: row.response?.status_code ?? null,
            response_body: null,
            error_body: row.error ?? { code: "unknown", message: "Parse error" },
            usage_data: null,
            raw: row,
          };
        } catch {
          console.warn("[openai-batch] Skipping unparseable error JSONL line");
          return null;
        }
      })
      .filter(Boolean) as ParsedBatchOutputRow[];
  },
} as BatchProviderAdapter & { parseErrorJsonl: (content: string) => ParsedBatchOutputRow[] };
