/**
 * lesson-gen/routing.ts — Provider selection, autopilot, cooldown filtering
 * OPT-3: Module-level P95 latency cache to skip redundant RPC per cold start.
 */

import { getModelChainAsync } from "../model-routing.ts";
import { resolveAvailableRoute } from "../llm/provider-load-balancer.ts";
import { filterCooledDownProviders } from "../llm/provider-cooldown.ts";
import {
  PLATFORM_HARD_LIMIT_MS,
  MIN_LLM_BUDGET_MS,
  MIN_PERSIST_MS,
  MIN_CHECKPOINT_MS,
  TOKEN_CLAMP_LESSON,
  TOKEN_CLAMP_MINICHECK,
} from "./constants.ts";
import type { LessonRequest, LessonRuntime } from "./types.ts";

// ── OPT-3: P95 latency cache (per cold start, ~30min TTL) ──
let _p95Cache: { p95Ms: number | null; fetchedAt: number } | null = null;
const P95_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

async function getCachedP95Latency(sb: any): Promise<number | null> {
  const now = Date.now();
  if (_p95Cache && (now - _p95Cache.fetchedAt) < P95_CACHE_TTL_MS) {
    return _p95Cache.p95Ms;
  }

  try {
    const { data: latencyStats } = await sb.rpc("get_provider_p95_latency", {
      p_job_type: "lesson_generate_content",
      p_window_minutes: 30,
    }).maybeSingle();

    const p95Ms = latencyStats?.p95_ms ?? null;
    _p95Cache = { p95Ms, fetchedAt: now };
    return p95Ms;
  } catch {
    // RPC doesn't exist yet or failed — cache the miss too
    _p95Cache = { p95Ms: null, fetchedAt: now };
    return null;
  }
}

/**
 * Resolve the LLM runtime configuration:
 * - Provider chain with cooldown filtering
 * - Single-provider selection per edge run
 * - Token clamps and timeouts
 * - Autopilot latency adjustments
 */
export async function resolveLessonRuntime(
  sb: any,
  req: LessonRequest,
  startMs: number,
  json: (body: unknown, status?: number) => Response,
): Promise<{ runtime: LessonRuntime } | { error: Response }> {
  const elapsedMs = Date.now() - startMs;
  const remainingPlatformMs = PLATFORM_HARD_LIMIT_MS - elapsedMs;
  const requiredMinMs = MIN_LLM_BUDGET_MS + MIN_PERSIST_MS + MIN_CHECKPOINT_MS;

  if (remainingPlatformMs < requiredMinMs) {
    console.warn(`[lesson-gen] FAST_FAIL: only ${remainingPlatformMs}ms left (need ${requiredMinMs}ms). Init took ${elapsedMs}ms.`);
    return {
      error: json({
        ok: false, retry: true,
        error: `SOFTSTOP: insufficient_time_budget (remaining=${remainingPlatformMs}ms, need=${requiredMinMs}ms, init=${elapsedMs}ms)`,
        elapsed_ms: elapsedMs,
      }, 503),
    };
  }

  // Autopilot: p95 latency check (OPT-3: cached)
  let maxTokensOverride: number | null = null;
  let autopilotAction: string | null = null;

  const workloadKey = req.isMiniCheck ? "minicheck" : "learning_content";

  // Chain resolution + P95 latency — run in parallel
  const [rawChainResult, p95Ms] = await Promise.all([
    (async () => {
      const policyRoute = await resolveAvailableRoute(workloadKey);
      if (policyRoute.ok && policyRoute.provider && policyRoute.model) {
        console.log(`[lesson-gen] POLICY_ROUTE: ${workloadKey} → ${policyRoute.provider}/${policyRoute.model}`);
        const hardcodedChain = await getModelChainAsync(req.isMiniCheck ? "minicheck" : "learning_content");
        return [
          { provider: policyRoute.provider as any, model: policyRoute.model },
          ...hardcodedChain.filter(c => c.model !== policyRoute.model),
        ];
      } else {
        console.log(`[lesson-gen] POLICY_MISS: ${workloadKey} (${policyRoute.reason}) → hardcoded chain`);
        return await getModelChainAsync(req.isMiniCheck ? "minicheck" : "learning_content");
      }
    })(),
    getCachedP95Latency(sb),
  ]);

  const rawChain = rawChainResult;

  if (p95Ms && p95Ms > 35_000) {
    const originalMax = req.isMiniCheck ? 2200 : 3200;
    maxTokensOverride = Math.round(originalMax * 0.65);
    autopilotAction = `p95_clamp: ${p95Ms}ms → tokens ${originalMax}→${maxTokensOverride}`;
    console.log(`[lesson-gen] AUTOPILOT: ${autopilotAction}`);
  }

  const fullChain = await filterCooledDownProviders(rawChain);

  // Single-provider per edge run
  const providerIndex = (req.jobHash + req.attemptIndex) % fullChain.length;
  const chain = [fullChain[providerIndex]];
  console.log(`[lesson-gen] SINGLE_PROVIDER: chain[${providerIndex}] = ${chain[0].provider}/${chain[0].model} (attempt=${req.attemptIndex}, hash=${req.jobHash}, chain_size=${fullChain.length}, job=${req.jobId.slice(0, 8)})`);

  const baseTokenClamp = req.isMiniCheck ? TOKEN_CLAMP_MINICHECK : TOKEN_CLAMP_LESSON;
  const effectiveMaxTokens = maxTokensOverride
    ? Math.min(maxTokensOverride, baseTokenClamp)
    : baseTokenClamp;

  const llmBudgetMs = remainingPlatformMs - MIN_PERSIST_MS - MIN_CHECKPOINT_MS;
  const llmTimeoutMs = Math.max(MIN_LLM_BUDGET_MS, Math.min(50_000, llmBudgetMs));

  console.log(`[lesson-gen] Time budget: init=${elapsedMs}ms, llm_cap=${llmTimeoutMs}ms, remaining=${remainingPlatformMs}ms, tokens=${effectiveMaxTokens}${autopilotAction ? `, autopilot=${autopilotAction}` : ""}`);

  return {
    runtime: {
      chain,
      fullChain,
      effectiveMaxTokens,
      llmTimeoutMs,
      remainingPlatformMs,
      autopilotAction,
      maxTokensOverride,
    },
  };
}
