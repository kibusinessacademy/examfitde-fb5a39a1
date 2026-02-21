/**
 * Multi-LLM AI Client – Direct Provider APIs
 *
 * Strategy:
 *   - OpenAI GPT-5.2:  Complex reasoning, course generation, tutoring
 *   - Anthropic Claude: Quality validation, post-hoc checks
 *   - Lovable Gateway:  Cost-efficient routing (Gemini, GPT-5)
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

import { fillUsage, estimateCostEur } from "./token-estimator.ts";

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
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    keyEnv: "GOOGLE_AI_API_KEY",
    format: "google",
  },
  lovable: {
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: "google/gemini-2.5-flash",
    keyEnv: "LOVABLE_API_KEY",
    format: "openai",
  },
};

/**
 * Call an AI provider directly. Returns the raw Response for streaming or JSON parsing.
 */
/** Default fetch timeout for AI calls (30s) — prevents Edge Function hard-timeout */
const AI_FETCH_TIMEOUT_MS = 55_000;

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

  // Dynamic timeout: large content gen needs more time, tool-calling adds latency
  const fetchTimeout = opts.max_tokens && opts.max_tokens > 4096
    ? 90_000 // 90s for large content generation (tool calling + long prompts)
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
    // OpenAI-compatible (OpenAI, Lovable)
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      ...(opts.stream !== undefined && { stream: opts.stream }),
    };
    // GPT-5 family: only supports temperature=1 (default) and max_completion_tokens
    const isGpt5 = model.startsWith("gpt-5") || model.includes("/gpt-5");
    const isLovableGpt5 = opts.provider === "lovable" && model.includes("openai/gpt-5");
    const gpt5Mode = isGpt5 || isLovableGpt5;

    if (opts.temperature !== undefined) {
      // GPT-5 only supports default temperature (1) — omit custom values
      if (!gpt5Mode) {
        body.temperature = opts.temperature;
      }
    }
    if (opts.max_tokens !== undefined) {
      if (gpt5Mode) {
        body.max_completion_tokens = opts.max_tokens;
      } else {
        body.max_tokens = opts.max_tokens;
      }
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
  estimatedUsage?: { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean };
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
    const model = opts.model || PROVIDER_DEFAULTS[opts.provider].model;

    if (opts.provider === "anthropic") {
      const toolUseBlock = data.content?.find((b: any) => b.type === "tool_use");
      const textBlock = data.content?.find((b: any) => b.type === "text");
      const content = textBlock?.text || "";
      const rawUsage = {
        input_tokens: data.usage?.input_tokens,
        output_tokens: data.usage?.output_tokens,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      };
      return {
        content,
        toolCalls: toolUseBlock ? [{ function: { name: toolUseBlock.name, arguments: JSON.stringify(toolUseBlock.input) } }] : undefined,
        usage: rawUsage,
        estimatedUsage: fillUsage(rawUsage, model, opts.messages, content),
      };
    }

    // OpenAI-compatible
    const choice = data.choices?.[0]?.message;
    const content = choice?.content || "";
    const rawUsage = data.usage;
    return {
      content,
      toolCalls: choice?.tool_calls,
      usage: rawUsage,
      estimatedUsage: fillUsage(
        rawUsage ? { input_tokens: rawUsage.prompt_tokens ?? rawUsage.input_tokens, output_tokens: rawUsage.completion_tokens ?? rawUsage.output_tokens } : undefined,
        model,
        opts.messages,
        content,
      ),
    };
  } catch (err: unknown) {
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
    cost_usd?: number;
    cost_eur?: number;
    package_id?: string | null;
    certification_id?: string | null;
    course_id?: string | null;
    status?: "success" | "fail" | "retry";
    error_message?: string | null;
    attempt?: number;
    meta?: Record<string, unknown>;
    estimated?: boolean;
    /** Pass estimatedUsage from callAIJSON/callAIWithFailover to auto-fill zeros */
    estimatedUsage?: { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean };
  }
): Promise<void> {
  try {
    // CRITICAL FIX: If provider returned 0 tokens (Lovable Gateway), use estimated values
    let tokensIn = opts.tokens_in;
    let tokensOut = opts.tokens_out;
    let isEstimated = opts.estimated ?? false;

    if (tokensIn === 0 && tokensOut === 0 && opts.estimatedUsage) {
      tokensIn = opts.estimatedUsage.tokens_in;
      tokensOut = opts.estimatedUsage.tokens_out;
      isEstimated = opts.estimatedUsage.estimated;
    }

    // Use estimated cost if no real cost provided
    const costEur = (tokensIn > 0 || tokensOut > 0)
      ? (opts.cost_eur ?? (opts.cost_usd ? opts.cost_usd * 0.92 : estimateCostEur(opts.model, tokensIn, tokensOut)))
      : (opts.estimatedUsage?.cost_eur ?? estimateCostEur(opts.model, 500, 200)); // minimum fallback: ~500 in + 200 out

    await sb.from("llm_cost_events").insert({
      job_type: opts.job_type,
      provider: opts.provider,
      model: opts.model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_eur: Math.round(costEur * 1_000_000) / 1_000_000, // 6 decimal precision
      package_id: opts.package_id || null,
      certification_id: opts.certification_id || null,
      course_id: opts.course_id || null,
      meta: {
        ...(opts.meta || {}),
        status: opts.status || "success",
        ...(opts.error_message ? { error: opts.error_message } : {}),
        ...(opts.attempt !== undefined ? { attempt: opts.attempt } : {}),
        ...(isEstimated ? { estimated: true } : {}),
      },
    });
  } catch {
    // Non-blocking
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
  estimatedUsage?: { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean };
}> {
  const PROVIDER_KEYS: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_AI_API_KEY",
    lovable: "LOVABLE_API_KEY",
  };

  const keyAvailability: Record<string, boolean> = {};
  for (const p of ["openai", "anthropic", "google", "lovable"]) {
    keyAvailability[p] = !!Deno.env.get(PROVIDER_KEYS[p]);
  }

  const errors: string[] = [];

  for (const candidate of chain) {
    if (!keyAvailability[candidate.provider]) {
      errors.push(`${candidate.provider}: no API key`);
      continue;
    }

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
        estimatedUsage: result.estimatedUsage,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.provider}/${candidate.model}: ${msg}`);
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
