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
 * Generic Hollow-Cache Detection.
 *
 * A cached response is considered "hollow" when it lacks substantive content
 * and would fail downstream post-conditions / quality gates. Returning a
 * hollow hit causes silent regeneration loops (see HOLLOW_GLOSSARY incident
 * 2026-04-18). Detection is conservative — false positives only cost one
 * regeneration; false negatives cost retry-exhaustion and HTTP 500 storms.
 *
 * Heuristics (all generic, no per-job-type knowledge):
 *  - body must be an object
 *  - serialized length must exceed MIN_BODY_LEN bytes
 *  - if body has `html` field → must be > 200 chars
 *  - if body has `questions`/`items`/`entries` array → must be non-empty
 *  - if body has `choices` array (OpenAI-shape) → first choice must have content
 */
const MIN_BODY_LEN = 200;

export function isCacheBodyHollow(body: unknown): { hollow: boolean; reason?: string } {
  if (!body || typeof body !== "object") return { hollow: true, reason: "not_object" };
  const serialized = JSON.stringify(body);
  if (serialized.length < MIN_BODY_LEN) return { hollow: true, reason: `body_too_short_${serialized.length}` };

  const b = body as Record<string, unknown>;

  if ("html" in b) {
    const html = b.html;
    if (typeof html !== "string" || html.trim().length < 200) {
      return { hollow: true, reason: "html_too_short" };
    }
  }

  for (const key of ["questions", "items", "entries"] as const) {
    if (key in b) {
      const arr = b[key];
      if (!Array.isArray(arr) || arr.length === 0) {
        return { hollow: true, reason: `${key}_empty` };
      }
    }
  }

  if (Array.isArray(b.choices)) {
    const first = b.choices[0] as any;
    const text = first?.message?.content || first?.text || "";
    if (typeof text !== "string" || text.trim().length < 100) {
      return { hollow: true, reason: "choices_no_content" };
    }
  }

  return { hollow: false };
}

/**
 * Check the cache for an existing response.
 *
 * Hollow entries are auto-invalidated (deleted) so the next call regenerates
 * fresh content instead of returning the same hollow body indefinitely.
 */
export async function checkCache(
  sb: any,
  cacheKey: string,
): Promise<CacheHit> {
  try {
    const { data, error } = await sb
      .from("ai_generation_cache")
      .select("id, response_body, model, hit_count, job_type")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error || !data) {
      return { found: false };
    }

    // Hollow-Cache Defense: validate substantive content before serving
    const hollow = isCacheBodyHollow(data.response_body);
    if (hollow.hollow) {
      console.warn(
        `[ai-gateway/cache] ⚠️ Hollow cache hit invalidated — job=${data.job_type} ` +
        `key=${cacheKey.slice(0, 12)} reason=${hollow.reason} — deleting`,
      );
      sb.from("ai_generation_cache").delete().eq("id", data.id)
        .then(() => {}).catch(() => {});
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
  // Refuse to store hollow bodies — prevents poisoning the cache at the source.
  const hollow = isCacheBodyHollow(opts.responseBody);
  if (hollow.hollow) {
    console.warn(
      `[ai-gateway/cache] ⚠️ Refused to store hollow body — job=${opts.jobType} ` +
      `reason=${hollow.reason}`,
    );
    return;
  }

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
