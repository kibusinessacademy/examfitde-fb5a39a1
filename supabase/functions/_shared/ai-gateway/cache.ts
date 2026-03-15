/**
 * ai-gateway/cache.ts — Prompt-fingerprint-based response cache.
 *
 * Prevents duplicate LLM calls for identical or near-identical prompts.
 * Particularly valuable for blueprint-based generation (exam pools, minichecks).
 */

import type { CacheHit } from "./types.ts";

/**
 * Generate a cache key from generation parameters.
 * Uses Web Crypto API (available in Deno/Edge Runtime).
 */
export async function buildCacheKey(parts: {
  jobType: string;
  model: string;
  promptHash: string;
  blueprintId?: string;
  difficulty?: string;
  schemaVersion?: string;
}): Promise<string> {
  const raw = [
    parts.jobType,
    parts.model,
    parts.promptHash,
    parts.blueprintId || "",
    parts.difficulty || "",
    parts.schemaVersion || "v1",
  ].join("|");

  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a prompt string for fingerprinting.
 */
export async function hashPrompt(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check the cache for an existing response.
 */
export async function checkCache(
  sb: any,
  cacheKey: string,
): Promise<CacheHit> {
  try {
    const { data, error } = await sb
      .from("ai_generation_cache")
      .select("id, response_body, model, hit_count")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error || !data) {
      return { found: false };
    }

    // Increment hit counter (best-effort)
    sb.from("ai_generation_cache")
      .update({ hit_count: (data.hit_count || 0) + 1, last_hit_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {})
      .catch(() => {});

    return {
      found: true,
      cacheId: data.id,
      responseBody: data.response_body,
      model: data.model,
    };
  } catch {
    return { found: false };
  }
}

/**
 * Store a response in the cache.
 */
export async function storeInCache(
  sb: any,
  opts: {
    cacheKey: string;
    jobType: string;
    provider?: string;
    model?: string;
    requestFingerprint: string;
    responseBody: Record<string, unknown>;
    usageData?: Record<string, unknown>;
    costEur?: number;
  },
): Promise<void> {
  try {
    await sb.from("ai_generation_cache").upsert(
      {
        cache_key: opts.cacheKey,
        job_type: opts.jobType,
        provider: opts.provider || null,
        model: opts.model || null,
        request_fingerprint: opts.requestFingerprint,
        response_body: opts.responseBody,
        usage_data: opts.usageData || null,
        cost_eur: opts.costEur || null,
        hit_count: 0,
        created_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" },
    );
  } catch (e) {
    console.warn(`[ai-gateway/cache] Store failed: ${(e as Error).message?.slice(0, 100)}`);
  }
}
