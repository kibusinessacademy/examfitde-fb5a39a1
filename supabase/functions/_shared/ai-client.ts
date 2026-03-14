/**
 * Multi-LLM AI Client – Direct Provider APIs
 *
 * Strategy:
 *   - OpenAI GPT-5.2:  Complex reasoning, course generation, tutoring
 *   - Anthropic Claude: Quality validation, content generation
 *
 * All calls go directly to provider APIs using stored API keys.
 */

import {
  recordRequest,
  recordRateLimit,
  recordServiceUnavailable,
  recordSuccess,
  getProviderHealth,
  pickAvailableProvider,
  type AIProvider,
} from "./provider-rate-limiter.ts";

import { warnIfUnclassifiedLlmError } from "./llm/normalize.ts";

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
  timeout_ms?: number;
  stream?: boolean;
  tools?: AITool[];
  tool_choice?: Record<string, unknown>;
  /** Caller-provided AbortSignal — combined with internal timeout for earliest-wins abort */
  signal?: AbortSignal;
}

export interface AIResponse {
  ok: boolean;
  status: number;
  raw: Response;
}

const PROVIDER_DEFAULTS: Record<AIProvider, { url: string; model: string; keyEnv: string; format: "openai" | "anthropic" | "google" }> = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5.2",
    keyEnv: "OPENAI_API_KEY",
    format: "openai",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-5-20250929",
    keyEnv: "ANTHROPIC_API_KEY",
    format: "anthropic",
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    keyEnv: "GOOGLE_AI_API_KEY",
    format: "google",
  },
};


/**
 * Token Param Adapter: determines if a model needs max_completion_tokens
 * instead of the legacy max_tokens parameter (and fixed temperature=1).
 * Covers: GPT-5 family, o1/o3 reasoning models.
 */
const MAX_COMPLETION_TOKEN_PREFIXES = [
  "gpt-5", "o1", "o1-", "o3", "o3-",
];
export function needsMaxCompletionTokens(model: string): boolean {
  // Direct model names: gpt-5, gpt-5-mini, gpt-5.2, o1, o1-mini, o3, o3-mini
  if (MAX_COMPLETION_TOKEN_PREFIXES.some(p => model === p || model.startsWith(p))) return true;
  return false;
}

/**
 * Call an AI provider directly. Returns the raw Response for streaming or JSON parsing.
 */
/** Default fetch timeout for AI calls — prevents Edge Function hard-timeout */
const AI_FETCH_TIMEOUT_MS = 48_000;  // v15: was 38s — raised to 48s. 38s was killing Anthropic responses mid-flight. Callers with tighter budgets pass explicit timeout_ms.

export async function callAI(opts: AIRequestOptions): Promise<AIResponse> {
  const cfg = PROVIDER_DEFAULTS[opts.provider];
  const apiKey = Deno.env.get(cfg.keyEnv);
  if (!apiKey) throw new Error(`${cfg.keyEnv} not configured`);

  // ── Proactive rate-limit check (with cooldown wait) ──
  let health = getProviderHealth(opts.provider);
  if (!health.available && health.cooldownRemainingMs > 0 && health.cooldownRemainingMs <= 20_000) {
    // Wait for short cooldowns instead of instantly failing (prevents tight-loop spam)
    const waitMs = health.cooldownRemainingMs + 500; // +500ms buffer
    console.info(`[AI-CLIENT] Provider ${opts.provider} on cooldown — waiting ${Math.round(waitMs / 1000)}s (step ${health.cooldownStep})`);
    await new Promise(r => setTimeout(r, waitMs));
    health = getProviderHealth(opts.provider); // Re-check after wait
  }
  if (!health.available) {
    console.warn(`[AI-CLIENT] Provider ${opts.provider} blocked: ${health.reason}`);
    throw new RateLimitError(`Provider ${opts.provider} proactively blocked: ${health.reason}`);
  }
  recordRequest(opts.provider);

  // Dynamic timeout: large content gen needs more time, tool-calling adds latency
  const fetchTimeout = opts.timeout_ms ?? (
    opts.max_tokens && opts.max_tokens > 4096
      ? 90_000 // 90s for large content generation (tool calling + long prompts)
      : AI_FETCH_TIMEOUT_MS
  );

  // ── Combine caller signal with internal timeout (earliest wins) ──
  const timeoutSignal = AbortSignal.timeout(fetchTimeout);
  const combinedSignal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;

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

    // ── Prompt Caching: wrap system prompt with cache_control ──
    // Anthropic caches system prompts with ≥1024 tokens, saving ~90% on input costs
    // for repeated calls with the same system prompt (pipeline, support, tutor).
    if (systemMsg) {
      const systemTokenEstimate = Math.ceil(systemMsg.content.length / 4);
      if (systemTokenEstimate >= 1024) {
        // Use structured system with cache_control for prompt caching
        body.system = [
          {
            type: "text",
            text: systemMsg.content,
            cache_control: { type: "ephemeral" },
          },
        ];
      } else {
        body.system = systemMsg.content;
      }
    }
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
        "anthropic-beta": "prompt-caching-2024-07-31",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
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
      signal: combinedSignal,
    });
  } else {
    // OpenAI-compatible (OpenAI direct)
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      ...(opts.stream !== undefined && { stream: opts.stream }),
    };
    // Models that require max_completion_tokens instead of max_tokens
    // and only support temperature=1 (default)
    const useMaxCompletionTokens = needsMaxCompletionTokens(model);

    if (opts.temperature !== undefined) {
      if (!useMaxCompletionTokens) {
        body.temperature = opts.temperature;
      }
    }
    if (opts.max_tokens !== undefined) {
      if (useMaxCompletionTokens) {
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
      signal: combinedSignal,
    });
  }

  // ── Record outcome for rate-limiter ──
  if (resp.status === 429) {
    recordRateLimit(opts.provider);
  } else if (resp.status === 503 || resp.status === 502 || resp.status === 504) {
    recordServiceUnavailable(opts.provider);
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
    // FIX: If provider returned 0 tokens, use estimated values
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
  opts: Omit<AIRequestOptions, "provider" | "model"> & { timeout_ms?: number },
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
  };

  const keyAvailability: Record<string, boolean> = {};
  for (const p of ["openai", "anthropic", "google"]) {
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
      // v16: Per-provider timeout support — each provider gets its own AbortController
      let perProviderAbort: AbortController | undefined;
      let perProviderTimer: number | undefined;
      const callOpts: AIRequestOptions = {
        ...opts,
        provider: candidate.provider,
        model: candidate.model,
      };
      if (opts.timeout_ms && !opts.signal) {
        perProviderAbort = new AbortController();
        perProviderTimer = setTimeout(() => perProviderAbort!.abort(), opts.timeout_ms) as unknown as number;
        callOpts.signal = perProviderAbort.signal;
      }
      const result = await callAIJSON(callOpts).finally(() => {
        if (perProviderTimer) clearTimeout(perProviderTimer);
      });

      // v5.4: Detect empty AI responses (HTTP 200 but no usable content)
      // and fall through to the next provider instead of returning garbage.
      const hasToolCalls = result.toolCalls && result.toolCalls.length > 0;
      const hasContent = result.content && result.content.trim().length > 0;
      if (!hasToolCalls && !hasContent) {
        const msg = `Empty response from ${candidate.provider}/${candidate.model} — falling through to next provider`;
        console.warn(`[AI-CLIENT] ${msg}`);
        errors.push(msg);
        continue;
      }

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
      warnIfUnclassifiedLlmError(err, { provider: candidate.provider, model: candidate.model });
    }
  }

  // ── v5.6 SAFETY NET: Plain-text JSON fallback (no tools/tool_choice) ──
  // If ALL providers returned empty with tool-calling, retry the FIRST
  // available provider WITHOUT tools — forces raw text completion.
  if (opts.tools && opts.tools.length > 0) {
    console.warn(`[AI-CLIENT] All tool-call providers empty — trying plain-text JSON fallback`);

    for (const candidate of chain) {
      if (!keyAvailability[candidate.provider]) continue;
      const health2 = getProviderHealth(candidate.provider);
      if (!health2.available) continue;

      try {
        // Strip tools/tool_choice, add JSON-only instruction
        const fallbackMessages = [
          ...opts.messages,
          {
            role: "system" as const,
            content: "IMPORTANT: The function-calling mode failed. Return ONLY valid JSON matching the required schema. No prose, no markdown fences, no explanation. If you cannot comply, return: {\"error\":\"cannot_generate\"}.",
          },
        ];

        const result = await callAIJSON({
          ...opts,
          provider: candidate.provider,
          model: candidate.model,
          tools: undefined,
          tool_choice: undefined,
        } as any);

        // Override messages with fallback messages
        const fallbackResult = await callAIJSON({
          provider: candidate.provider,
          model: candidate.model,
          messages: fallbackMessages,
          temperature: opts.temperature,
          max_tokens: opts.max_tokens,
          signal: opts.signal,
        });

        if (fallbackResult.content && fallbackResult.content.trim().length > 0) {
          console.log(`[AI-CLIENT] ✅ Plain-text fallback succeeded via ${candidate.provider}/${candidate.model} (${fallbackResult.content.length} chars)`);
          return {
            content: fallbackResult.content,
            toolCalls: undefined,
            provider: candidate.provider,
            model: candidate.model,
            usage: fallbackResult.usage,
            estimatedUsage: fallbackResult.estimatedUsage,
          };
        }
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        errors.push(`FALLBACK ${candidate.provider}/${candidate.model}: ${msg2}`);
      }
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
