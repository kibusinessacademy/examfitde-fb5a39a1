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
import { isDriftProneModel } from "./model-aliases.ts";

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

/**
 * Lovable AI Gateway — SSOT for openai/google providers.
 *
 * Direct calls to api.openai.com or generativelanguage.googleapis.com
 * fail on Gateway-only model names (e.g. `gpt-5.4-mini`, `gemini-2.5-flash`).
 * The Gateway accepts prefixed model IDs (`openai/...`, `google/...`) and
 * authenticates via `LOVABLE_API_KEY` for both providers.
 *
 * When LOVABLE_API_KEY is present (always true in this project), `openai`
 * and `google` providers are routed through the Gateway. The model name is
 * auto-prefixed if the caller passed an unprefixed value.
 *
 * Anthropic stays direct (separate API + key + endpoint).
 */
const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function lovableGatewayEnabled(): boolean {
  return !!Deno.env.get("LOVABLE_API_KEY");
}

function ensureGatewayModel(provider: AIProvider, model: string): string {
  if (model.includes("/")) return model; // already prefixed
  if (provider === "openai") return `openai/${model}`;
  if (provider === "google") return `google/${model}`;
  return model;
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

  // ── SSOT routing: openai + google route through Lovable AI Gateway ──
  // The Gateway accepts both providers via LOVABLE_API_KEY and avoids
  // `invalid model ID` errors caused by Gateway-only model names being
  // sent to api.openai.com directly.
  const useGateway = lovableGatewayEnabled() && (opts.provider === "openai" || opts.provider === "google");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const apiKey = useGateway ? lovableKey! : Deno.env.get(cfg.keyEnv);
  if (!apiKey) throw new Error(`${useGateway ? "LOVABLE_API_KEY" : cfg.keyEnv} not configured`);
  const targetUrl = useGateway ? LOVABLE_GATEWAY_URL : cfg.url;

  // ── Proactive rate-limit check (with cooldown wait) ──
  let health = getProviderHealth(opts.provider);
  
  // Wait for cooldowns up to 30s (prevents death spiral from tight-loop retries)
  if (!health.available && health.cooldownRemainingMs > 0 && health.cooldownRemainingMs <= 30_000) {
    const waitMs = health.cooldownRemainingMs + 500; // +500ms buffer
    console.info(`[AI-CLIENT] Provider ${opts.provider} on cooldown — waiting ${Math.round(waitMs / 1000)}s (step ${health.cooldownStep})`);
    await new Promise(r => setTimeout(r, waitMs));
    health = getProviderHealth(opts.provider); // Re-check after wait
  }
  
  // If RPM-limited (not cooldown), wait 2-5s for slot to free up
  if (!health.available && health.cooldownRemainingMs === 0 && health.reason?.startsWith("rpm_limit")) {
    const waitMs = 2000 + Math.random() * 3000; // jittered 2-5s
    console.info(`[AI-CLIENT] Provider ${opts.provider} RPM-limited (${health.rpm}/${health.rpmLimit}) — waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise(r => setTimeout(r, waitMs));
    health = getProviderHealth(opts.provider); // Re-check after wait
  }
  
  if (!health.available) {
    // Don't record blocked calls as requests — this was causing the death spiral
    console.warn(`[AI-CLIENT] Provider ${opts.provider} still blocked after wait: ${health.reason}`);
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

  // Auto-prefix model when routing through Gateway (e.g. `gpt-5.4-mini` → `openai/gpt-5.4-mini`).
  const rawModel = opts.model || cfg.model;
  const model = useGateway ? ensureGatewayModel(opts.provider, rawModel) : rawModel;

  if (useGateway && rawModel !== model) {
    console.info(`[AI-CLIENT] Gateway route: ${opts.provider} ${rawModel} → ${model} (auto-prefixed)`);
  }
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
        // NOTE: prompt-caching-2024-07-31 beta header REMOVED — caching is GA since Dec 2024.
        // The deprecated beta header was being rejected by newer models, preventing caching entirely.
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } else if (cfg.format === "google") {
    // Google provider — currently disabled, kept for infrastructure compatibility
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      ...(opts.stream !== undefined && { stream: opts.stream }),
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;

    resp = await fetch(targetUrl, {
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

    resp = await fetch(targetUrl, {
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
  finish_reason?: string;
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
        // Prompt caching telemetry (GA since Dec 2024)
        cache_creation_input_tokens: data.usage?.cache_creation_input_tokens || 0,
        cache_read_input_tokens: data.usage?.cache_read_input_tokens || 0,
      };
      return {
        content,
        toolCalls: toolUseBlock ? [{ function: { name: toolUseBlock.name, arguments: JSON.stringify(toolUseBlock.input) } }] : undefined,
        usage: rawUsage,
        estimatedUsage: fillUsage(rawUsage, model, opts.messages, content),
        finish_reason: data.stop_reason || undefined,
      };
    }

    // OpenAI-compatible
    const choice0 = data.choices?.[0];
    const choice = choice0?.message;
    const content = choice?.content || "";
    const rawUsage = data.usage;
    return {
      content,
      toolCalls: choice?.tool_calls,
      usage: rawUsage,
      finish_reason: choice0?.finish_reason || undefined,
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

// ── Usage normalizer: handles all provider quirks centrally ──
function normalizeUsage(
  usage?: Record<string, any>,
  estimatedUsage?: { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean },
): {
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  is_estimated: boolean;
} {
  const tokensIn =
    usage?.input_tokens ??
    usage?.prompt_tokens ??
    0;

  const tokensOut =
    usage?.output_tokens ??
    usage?.completion_tokens ??
    0;

  const total =
    usage?.total_tokens ??
    ((tokensIn || 0) + (tokensOut || 0));

  // Handle total_tokens-only cases (some providers return only total)
  const normalizedIn = tokensIn || (tokensOut === 0 && total > 0 ? total : 0);
  const normalizedOut = tokensOut;

  const finalIn = normalizedIn || estimatedUsage?.tokens_in || 0;
  const finalOut = normalizedOut || estimatedUsage?.tokens_out || 0;
  const isEstimated = (finalIn !== normalizedIn || finalOut !== normalizedOut) || (!tokensIn && !tokensOut);

  return {
    tokens_in: finalIn,
    tokens_out: finalOut,
    total_tokens: total || ((estimatedUsage?.tokens_in || 0) + (estimatedUsage?.tokens_out || 0)),
    cache_creation_input_tokens: usage?.cache_creation_input_tokens || 0,
    cache_read_input_tokens: usage?.cache_read_input_tokens || 0,
    is_estimated: isEstimated,
  };
}

/** Canonical status set for LLM cost events */
export type LLMCostStatus = "success" | "error" | "retry" | "timeout" | "rate_limited" | "aborted" | "skipped";

/**
 * Log an LLM cost event to llm_cost_events table.
 * NEVER throws — safe to await directly without try/catch wrapping.
 * Call this after every AI call (success, error, retry) for ROI tracking.
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
    status?: LLMCostStatus;
    error_message?: string | null;
    attempt?: number;
    meta?: Record<string, unknown>;
    estimated?: boolean;
    /** Pass estimatedUsage from callAIJSON/callAIWithFailover to auto-fill zeros */
    estimatedUsage?: { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean };
    latency_ms?: number;
    finish_reason?: string;
    cached_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    trace_id?: string;
  }
): Promise<void> {
  try {
    // Normalize usage through central function
    const norm = normalizeUsage(
      { input_tokens: opts.tokens_in, output_tokens: opts.tokens_out, cache_creation_input_tokens: opts.cache_creation_input_tokens, cache_read_input_tokens: opts.cache_read_input_tokens },
      opts.estimatedUsage,
    );

    const tokensIn = norm.tokens_in;
    const tokensOut = norm.tokens_out;
    const isEstimated = opts.estimated ?? norm.is_estimated;

    // Use estimated cost if no real cost provided
    const costEur = (tokensIn > 0 || tokensOut > 0)
      ? (opts.cost_eur ?? (opts.cost_usd ? opts.cost_usd * 0.92 : estimateCostEur(opts.model, tokensIn, tokensOut)))
      : (opts.estimatedUsage?.cost_eur ?? estimateCostEur(opts.model, 500, 200)); // minimum fallback: ~500 in + 200 out

    const { error: insertErr } = await sb.from("llm_cost_events").insert({
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
        ...(opts.error_message ? { error: opts.error_message.slice(0, 500) } : {}),
        ...(opts.attempt !== undefined ? { attempt: opts.attempt } : {}),
        ...(isEstimated ? { estimated: true } : {}),
        ...(opts.latency_ms !== undefined ? { latency_ms: opts.latency_ms } : {}),
        ...(opts.finish_reason ? { finish_reason: opts.finish_reason } : {}),
        ...(norm.cache_creation_input_tokens ? { cache_creation_input_tokens: norm.cache_creation_input_tokens } : {}),
        ...(norm.cache_read_input_tokens ? { cache_read_input_tokens: norm.cache_read_input_tokens } : {}),
        ...(opts.trace_id ? { trace_id: opts.trace_id } : {}),
      },
    });

    if (insertErr) {
      console.error(`[llm-cost-log-FAILED] job=${opts.job_type} provider=${opts.provider} model=${opts.model} trace=${opts.trace_id || "?"} err=${insertErr.message?.slice(0, 200)}`);
      // Fallback: try ops_events as safety net
      try {
        await sb.from("ops_events").insert({
          event_type: "llm_cost_log_failed",
          severity: "warn",
          payload: {
            job_type: opts.job_type,
            provider: opts.provider,
            model: opts.model,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            cost_eur: costEur,
            trace_id: opts.trace_id || null,
            insert_error: insertErr.message?.slice(0, 200),
          },
        });
      } catch { /* double-fallback best-effort */ }
    }
  } catch (outerErr) {
    // NEVER throw — this function is safe to await without wrapping
    console.error(`[llm-cost-log-FAILED] OUTER job=${opts.job_type} provider=${opts.provider} model=${opts.model} trace=${opts.trace_id || "?"} err=${(outerErr as Error)?.message?.slice(0, 200)}`);
  }
}

// ── Internal: lightweight REST-based auto-log client (no createClient dependency) ──
let _autoLogSb: { from: (table: string) => any } | null = null;
function getAutoLogSb(): { from: (table: string) => any } | null {
  if (_autoLogSb) return _autoLogSb;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return null;
    // Minimal REST wrapper — only supports .insert() for llm_cost_events
    _autoLogSb = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          try {
            const resp = await fetch(`${url}/rest/v1/${table}`, {
              method: "POST",
              headers: {
                "apikey": key,
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
              },
              body: JSON.stringify(row),
            });
            if (!resp.ok) {
              const errText = await resp.text().catch(() => "");
              return { error: { message: `REST insert failed: ${resp.status} ${errText.slice(0, 100)}` } };
            }
            return { error: null };
          } catch (e) {
            return { error: { message: (e as Error)?.message || "fetch failed" } };
          }
        },
      }),
    };
    return _autoLogSb;
  } catch { /* no auto-log client available */ }
  return null;
}

// ── Generate trace IDs for request correlation ──
function generateTraceId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
export interface FailoverTelemetry {
  route: string; // "chain" | "plain_json_fallback"
  provider: string;
  model: string;
  fallback_rank: number; // 0-based index in chain
  resolved_via: "db_policy" | "hardcoded_fallback" | "plain_json_fallback";
  finish_reason?: string;
  raw_text_length: number;
  is_drift_prone: boolean;
  attempts_before: number; // how many providers were skipped/failed before this one
}

/** Optional context for automatic cost logging inside callAIWithFailover */
export interface LLMJobContext {
  sb?: { from: (table: string) => any };
  job_type?: string;
  package_id?: string | null;
  course_id?: string | null;
  certification_id?: string | null;
}

export async function callAIWithFailover(
  chain: Array<{ provider: AIProvider; model: string }>,
  opts: Omit<AIRequestOptions, "provider" | "model"> & { timeout_ms?: number },
  jobContext?: LLMJobContext,
): Promise<{
  content: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }>;
  provider: AIProvider;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  estimatedUsage?: { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean };
  telemetry?: FailoverTelemetry;
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
  let candidateRank = 0;  // position in chain (includes skips)
  let actualAttempt = 0;  // only real HTTP calls
  const traceId = generateTraceId();

  // Resolve logging client: explicit sb > globalThis > auto-create
  const logSb = jobContext?.sb || (globalThis as any).__llmLogSb || getAutoLogSb();
  const jobType = jobContext?.job_type || (globalThis as any).__llmJobType || "unknown";

  // Helper: auto-log an attempt — awaited (logLLMCostEvent never throws)
  const autoLog = async (
    p: string, m: string, status: LLMCostStatus, latencyMs: number,
    opts2: { usage?: any; estimatedUsage?: any; finishReason?: string; errorMsg?: string; wasCalled: boolean; skipReason?: string },
  ) => {
    if (!logSb) return;
    const norm = normalizeUsage(opts2.usage, opts2.estimatedUsage);
    await logLLMCostEvent(logSb, {
      job_type: jobType,
      provider: p,
      model: m,
      tokens_in: norm.tokens_in,
      tokens_out: norm.tokens_out,
      status,
      attempt: opts2.wasCalled ? actualAttempt : undefined,
      latency_ms: latencyMs,
      finish_reason: opts2.finishReason,
      error_message: opts2.errorMsg,
      package_id: jobContext?.package_id,
      course_id: jobContext?.course_id,
      certification_id: jobContext?.certification_id,
      estimatedUsage: opts2.estimatedUsage,
      cache_creation_input_tokens: norm.cache_creation_input_tokens,
      cache_read_input_tokens: norm.cache_read_input_tokens,
      trace_id: traceId,
      meta: {
        chain_size: chain.length,
        candidate_rank: candidateRank,
        attempt_no: opts2.wasCalled ? actualAttempt : undefined,
        was_called: opts2.wasCalled,
        ...(opts2.skipReason ? { skip_reason: opts2.skipReason } : {}),
      },
    });
  };

  for (const candidate of chain) {
    if (!keyAvailability[candidate.provider]) {
      errors.push(`${candidate.provider}: no API key`);
      await autoLog(candidate.provider, candidate.model, "skipped", 0, { wasCalled: false, skipReason: "no_api_key" });
      candidateRank++;
      continue;
    }

    const health = getProviderHealth(candidate.provider);
    if (!health.available) {
      errors.push(`${candidate.provider}: ${health.reason}`);
      await autoLog(candidate.provider, candidate.model, "rate_limited", 0, { wasCalled: false, skipReason: health.reason, errorMsg: health.reason });
      candidateRank++;
      continue;
    }

    const attemptStart = Date.now();
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

      const latencyMs = Date.now() - attemptStart;

      // v5.4: Detect empty AI responses (HTTP 200 but no usable content)
      const hasToolCalls = result.toolCalls && result.toolCalls.length > 0;
      const hasContent = result.content && result.content.trim().length > 0;
      if (!hasToolCalls && !hasContent) {
        const msg = `Empty response from ${candidate.provider}/${candidate.model} — falling through to next provider`;
        console.warn(`[AI-CLIENT] ${msg}`);
        errors.push(msg);
        await autoLog(candidate.provider, candidate.model, "error", latencyMs, { usage: result.usage, estimatedUsage: result.estimatedUsage, finishReason: result.finish_reason, errorMsg: "empty_response", wasCalled: true });
        actualAttempt++;
        candidateRank++;
        continue;
      }

      // ── SUCCESS: auto-log this attempt ──
      await autoLog(candidate.provider, candidate.model, "success", latencyMs, { usage: result.usage, estimatedUsage: result.estimatedUsage, finishReason: result.finish_reason, wasCalled: true });

      const telemetry: FailoverTelemetry = {
        route: "chain",
        provider: candidate.provider,
        model: candidate.model,
        fallback_rank: candidateRank,
        resolved_via: candidateRank === 0 ? "db_policy" : "hardcoded_fallback",
        finish_reason: result.finish_reason,
        raw_text_length: (result.content || "").length,
        is_drift_prone: isDriftProneModel(candidate.model),
        attempts_before: actualAttempt,
      };

      if (candidateRank > 0) {
        console.log(`[AI-CLIENT] FAILOVER_TELEMETRY: resolved via rank=${candidateRank} ${candidate.provider}/${candidate.model} (drift_prone=${telemetry.is_drift_prone}, text_len=${telemetry.raw_text_length})`);
      }

      return {
        content: result.content,
        toolCalls: result.toolCalls,
        provider: candidate.provider,
        model: candidate.model,
        usage: result.usage,
        estimatedUsage: result.estimatedUsage,
        telemetry,
      };
    } catch (err) {
      const latencyMs = Date.now() - attemptStart;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.provider}/${candidate.model}: ${msg}`);
      warnIfUnclassifiedLlmError(err, { provider: candidate.provider, model: candidate.model });

      // ── FAIL: auto-log this attempt ──
      const errStatus: LLMCostStatus = err instanceof RateLimitError ? "rate_limited"
        : err instanceof AITimeoutError ? "timeout"
        : msg.includes("AbortError") ? "aborted"
        : "error";
      await autoLog(candidate.provider, candidate.model, errStatus, latencyMs, { errorMsg: msg.slice(0, 300), wasCalled: true });

      actualAttempt++;
      candidateRank++;
    }
  }

  // ── v5.6 SAFETY NET: Plain-text JSON fallback (no tools/tool_choice) ──
  if (opts.tools && opts.tools.length > 0) {
    console.warn(`[AI-CLIENT] All tool-call providers empty — trying plain-text JSON fallback`);

    let fallbackRank = 0;
    for (const candidate of chain) {
      if (!keyAvailability[candidate.provider]) continue;
      const health2 = getProviderHealth(candidate.provider);
      if (!health2.available) continue;

      const attemptStart = Date.now();
      try {
        const fallbackMessages = [
          ...opts.messages,
          {
            role: "system" as const,
            content: "IMPORTANT: The function-calling mode failed. Return ONLY valid JSON matching the required schema. No prose, no markdown fences, no explanation. If you cannot comply, return: {\"error\":\"cannot_generate\"}.",
          },
        ];

        const fallbackResult = await callAIJSON({
          provider: candidate.provider,
          model: candidate.model,
          messages: fallbackMessages,
          temperature: opts.temperature,
          max_tokens: opts.max_tokens,
          signal: opts.signal,
        });

        const latencyMs = Date.now() - attemptStart;
        actualAttempt++;

        if (fallbackResult.content && fallbackResult.content.trim().length > 0) {
          await autoLog(candidate.provider, candidate.model, "success", latencyMs, { usage: fallbackResult.usage, estimatedUsage: fallbackResult.estimatedUsage, finishReason: fallbackResult.finish_reason, wasCalled: true });

          const telemetry: FailoverTelemetry = {
            route: "plain_json_fallback",
            provider: candidate.provider,
            model: candidate.model,
            fallback_rank: chain.length + fallbackRank,
            resolved_via: "plain_json_fallback",
            raw_text_length: fallbackResult.content.length,
            is_drift_prone: isDriftProneModel(candidate.model),
            attempts_before: actualAttempt,
          };
          console.log(`[AI-CLIENT] ✅ Plain-text fallback succeeded via ${candidate.provider}/${candidate.model} (${fallbackResult.content.length} chars, drift_prone=${telemetry.is_drift_prone})`);
          return {
            content: fallbackResult.content,
            toolCalls: undefined,
            provider: candidate.provider,
            model: candidate.model,
            usage: fallbackResult.usage,
            estimatedUsage: fallbackResult.estimatedUsage,
            telemetry,
          };
        }
      } catch (err2) {
        const latencyMs = Date.now() - attemptStart;
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        errors.push(`FALLBACK ${candidate.provider}/${candidate.model}: ${msg2}`);
        await autoLog(candidate.provider, candidate.model, "error", latencyMs, { errorMsg: msg2.slice(0, 300), wasCalled: true });
        actualAttempt++;
      }
      fallbackRank++;
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
