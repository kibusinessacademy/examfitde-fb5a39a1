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

import {
  recordRequest,
  recordRateLimit,
  recordSuccess,
  getProviderHealth,
  pickAvailableProvider,
  type AIProvider,
} from "./provider-rate-limiter.ts";

export type { AIProvider };

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

const PROVIDER_DEFAULTS: Record<AIProvider, { url: string; model: string; keyEnv: string; format: "openai" | "anthropic" | "google" }> = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1",
    keyEnv: "OPENAI_API_KEY",
    format: "openai",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    keyEnv: "ANTHROPIC_API_KEY",
    format: "anthropic",
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    keyEnv: "DEEPSEEK_API_KEY",
    format: "openai",
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    keyEnv: "GOOGLE_AI_API_KEY",
    format: "google",
  },
};

/**
 * Call an AI provider directly. Returns the raw Response for streaming or JSON parsing.
 */
/** Default fetch timeout for AI calls (30s) — prevents Edge Function hard-timeout */
const AI_FETCH_TIMEOUT_MS = 30_000;

export async function callAI(opts: AIRequestOptions): Promise<AIResponse> {
  const cfg = PROVIDER_DEFAULTS[opts.provider];
  const apiKey = Deno.env.get(cfg.keyEnv);
  if (!apiKey) throw new Error(`${cfg.keyEnv} not configured`);

  // ── Proactive rate-limit check ──
  const health = getProviderHealth(opts.provider);
  if (!health.available) {
    console.warn(`[AI-CLIENT] Provider ${opts.provider} blocked: ${health.reason}`);
    throw new RateLimitError(`Provider ${opts.provider} proactively blocked: ${health.reason}`);
  }
  recordRequest(opts.provider);

  const fetchTimeout = opts.max_tokens && opts.max_tokens > 8192
    ? 55_000 // longer timeout for large generations
    : AI_FETCH_TIMEOUT_MS;

  const model = opts.model || cfg.model;

  let resp: Response;

  if (cfg.format === "anthropic") {
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

    // Anthropic tool support: convert OpenAI tool format → Anthropic format
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }
    if (opts.tool_choice) {
      const fnName = (opts.tool_choice as any).function?.name;
      if (fnName) {
        body.tool_choice = { type: "tool", name: fnName };
      }
    }

    resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(fetchTimeout),
    });
  } else if (cfg.format === "google") {
    // Google Gemini uses OpenAI-compatible endpoint with API key in header
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      ...(opts.stream !== undefined && { stream: opts.stream }),
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;

    resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(fetchTimeout),
    });
  } else {
    // OpenAI-compatible (OpenAI, DeepSeek)
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      ...(opts.stream !== undefined && { stream: opts.stream }),
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.max_tokens !== undefined) {
      // DeepSeek hard limit: max_tokens must be ≤ 8192
      body.max_tokens = opts.provider === "deepseek"
        ? Math.min(opts.max_tokens, 8192)
        : opts.max_tokens;
    }
    if (opts.tools) body.tools = opts.tools;
    if (opts.tool_choice) body.tool_choice = opts.tool_choice;

    resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(fetchTimeout),
    });
  }

  // ── Record outcome for rate-limiter ──
  if (resp.status === 429) {
    recordRateLimit(opts.provider);
  } else if (resp.ok) {
    recordSuccess(opts.provider);
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
  try {
    const { raw, ok, status } = await callAI({ ...opts, stream: false });

    if (!ok) {
      const errText = await raw.text().catch(() => "");
      if (status === 429) throw new RateLimitError("Rate limit exceeded");
      if (status === 402) throw new PaymentRequiredError("Payment required");
      throw new Error(`AI ${opts.provider} error ${status}: ${errText.slice(0, 200)}`);
    }

    const data = await raw.json();

  if (opts.provider === "anthropic") {
    // Extract tool_use blocks if present
    const toolUseBlock = data.content?.find((b: any) => b.type === "tool_use");
    const textBlock = data.content?.find((b: any) => b.type === "text");
    return {
      content: textBlock?.text || "",
      toolCalls: toolUseBlock ? [{ function: { name: toolUseBlock.name, arguments: JSON.stringify(toolUseBlock.input) } }] : undefined,
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
  } catch (err: unknown) {
    // Convert AbortError / TimeoutError into AITimeoutError
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new AITimeoutError(`AI ${opts.provider} request timed out`);
    }
    throw err;
  }
}

/**
 * Log an LLM cost event to llm_cost_events table.
 * Call this after every AI call (success, fail, retry) for ROI tracking.
 *
 * @param opts.status - "success" | "fail" | "retry" (default: "success")
 * @param opts.error_message - Error text for failed calls
 * @param opts.attempt - Which attempt number (for retry tracking)
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
    status?: "success" | "fail" | "retry";
    error_message?: string | null;
    attempt?: number;
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
      meta: {
        ...(opts.meta || {}),
        status: opts.status || "success",
        ...(opts.error_message ? { error: opts.error_message } : {}),
        ...(opts.attempt !== undefined ? { attempt: opts.attempt } : {}),
      },
    });
  } catch {
    // Non-blocking – don't let cost logging break production
  }
}

// Re-export rate limiter utilities for direct use
export {
  getProviderHealth,
  getAllProviderHealth,
  pickAvailableProvider,
  clearCooldown,
} from "./provider-rate-limiter.ts";

/**
 * Call AI with automatic failover across a model chain.
 * Skips providers that are in cooldown or at RPM limit.
 * Falls through the chain until one succeeds or all fail.
 */
export async function callAIWithFailover(
  chain: Array<{ provider: AIProvider; model: string }>,
  opts: Omit<AIRequestOptions, "provider" | "model">,
): Promise<{
  content: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }>;
  provider: AIProvider;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}> {
  const PROVIDER_KEYS: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    google: "GOOGLE_AI_API_KEY",
  };

  // Build API key availability map
  const keyAvailability: Record<string, boolean> = {};
  for (const p of ["openai", "anthropic", "deepseek", "google"]) {
    keyAvailability[p] = !!Deno.env.get(PROVIDER_KEYS[p]);
  }

  const errors: string[] = [];

  for (const candidate of chain) {
    // Skip if no API key
    if (!keyAvailability[candidate.provider]) {
      errors.push(`${candidate.provider}: no API key`);
      continue;
    }

    // Skip if provider is blocked (cooldown or RPM)
    const health = getProviderHealth(candidate.provider);
    if (!health.available) {
      errors.push(`${candidate.provider}: ${health.reason}`);
      continue;
    }

    try {
      const result = await callAIJSON({
        ...opts,
        provider: candidate.provider,
        model: candidate.model,
      });
      return {
        content: result.content,
        toolCalls: result.toolCalls,
        provider: candidate.provider,
        model: candidate.model,
        usage: result.usage,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.provider}/${candidate.model}: ${msg}`);
      // Continue to next provider in chain
    }
  }

  throw new Error(`All providers failed: ${errors.join(" | ")}`);
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

export class AITimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AITimeoutError";
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
  if (error instanceof AITimeoutError) {
    return new Response(
      JSON.stringify({ error: "AI-Anfrage Timeout. Wird automatisch wiederholt.", retry: true }),
      { status: 504, headers }
    );
  }

  const msg = error instanceof Error ? error.message : "Unknown AI error";
  return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
}
