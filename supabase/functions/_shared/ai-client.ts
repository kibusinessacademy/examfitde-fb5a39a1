/**
 * Multi-LLM AI Client – Direct Provider APIs (Bypass Lovable Credits)
 *
 * Strategy:
 *   - OpenAI GPT-5.2:  Complex reasoning, course generation, tutoring
 *   - Anthropic Claude: Quality validation, post-hoc checks
 *   - DeepSeek:         Cost-efficient extraction, SEO, marketing, support
 *
 * All calls go directly to provider APIs using stored API keys.
 */

export type AIProvider = "openai" | "anthropic" | "deepseek";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AIRequestOptions {
  provider: AIProvider;
  model?: string;
  messages: AIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: AITool[];
  tool_choice?: Record<string, unknown>;
}

export interface AIResponse {
  ok: boolean;
  status: number;
  raw: Response;
}

const PROVIDER_DEFAULTS: Record<AIProvider, { url: string; model: string; keyEnv: string }> = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1",
    keyEnv: "OPENAI_API_KEY",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    keyEnv: "ANTHROPIC_API_KEY",
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    keyEnv: "DEEPSEEK_API_KEY",
  },
};

/**
 * Call an AI provider directly. Returns the raw Response for streaming or JSON parsing.
 */
export async function callAI(opts: AIRequestOptions): Promise<AIResponse> {
  const cfg = PROVIDER_DEFAULTS[opts.provider];
  const apiKey = Deno.env.get(cfg.keyEnv);
  if (!apiKey) throw new Error(`${cfg.keyEnv} not configured`);

  const model = opts.model || cfg.model;

  let resp: Response;

  if (opts.provider === "anthropic") {
    // Anthropic has a different API format
    const systemMsg = opts.messages.find((m) => m.role === "system");
    const nonSystemMsgs = opts.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.max_tokens || 4096,
      messages: nonSystemMsgs,
      ...(opts.stream !== undefined && { stream: opts.stream }),
    };
    if (systemMsg) body.system = systemMsg.content;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    // Note: Anthropic tool calling has a different format; handle if needed

    resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } else {
    // OpenAI-compatible (OpenAI, DeepSeek)
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      ...(opts.stream !== undefined && { stream: opts.stream }),
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
    if (opts.tools) body.tools = opts.tools;
    if (opts.tool_choice) body.tool_choice = opts.tool_choice;

    resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  return { ok: resp.ok, status: resp.status, raw: resp };
}

/**
 * Convenience: Call AI and parse JSON response (non-streaming).
 * Returns the parsed response body.
 */
export async function callAIJSON(opts: Omit<AIRequestOptions, "stream">): Promise<{
  content: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}> {
  const { raw, ok, status } = await callAI({ ...opts, stream: false });

  if (!ok) {
    const errText = await raw.text().catch(() => "");
    if (status === 429) throw new RateLimitError("Rate limit exceeded");
    if (status === 402) throw new PaymentRequiredError("Payment required");
    throw new Error(`AI ${opts.provider} error ${status}: ${errText.slice(0, 200)}`);
  }

  const data = await raw.json();

  if (opts.provider === "anthropic") {
    return {
      content: data.content?.[0]?.text || "",
      usage: {
        input_tokens: data.usage?.input_tokens,
        output_tokens: data.usage?.output_tokens,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  // OpenAI-compatible
  const choice = data.choices?.[0]?.message;
  return {
    content: choice?.content || "",
    toolCalls: choice?.tool_calls,
    usage: data.usage,
  };
}

/**
 * Log an LLM cost event to llm_cost_events table.
 * Call this after every successful AI call for ROI tracking.
 */
export async function logLLMCostEvent(
  sb: { from: (table: string) => any },
  opts: {
    job_type: string;
    provider: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    package_id?: string | null;
    certification_id?: string | null;
    course_id?: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await sb.from("llm_cost_events").insert({
      job_type: opts.job_type,
      provider: opts.provider,
      model: opts.model,
      tokens_in: opts.tokens_in,
      tokens_out: opts.tokens_out,
      cost_usd: opts.cost_usd,
      package_id: opts.package_id || null,
      certification_id: opts.certification_id || null,
      course_id: opts.course_id || null,
      meta: opts.meta || {},
    });
  } catch {
    // Non-blocking – don't let cost logging break production
  }
}
export class RateLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "RateLimitError";
  }
}

export class PaymentRequiredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PaymentRequiredError";
  }
}

/**
 * Build a standard error response for AI errors (429/402/500).
 */
export function aiErrorResponse(
  error: unknown,
  corsHeaders: Record<string, string>
): Response {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (error instanceof RateLimitError) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Bitte später erneut versuchen." }),
      { status: 429, headers }
    );
  }
  if (error instanceof PaymentRequiredError) {
    return new Response(
      JSON.stringify({ error: "AI-Kontingent erschöpft. Bitte Credits aufladen." }),
      { status: 402, headers }
    );
  }

  const msg = error instanceof Error ? error.message : "Unknown AI error";
  return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
}
