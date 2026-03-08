// supabase/functions/_shared/llm/empty-response-fallback.ts
// Soft-fallback for empty LLM responses: retry plain JSON mode before cooldown.
// IMPORTANT: Edge-Function-only (Deno). Never import from client.

import { setProviderCooldown } from "./provider-cooldown.ts";

export interface FallbackCallResult {
  text?: string;
}

/**
 * Ensures a non-empty text response from an LLM call.
 * If the initial response is empty, retries with a plain JSON fallback.
 * If still empty, sets a provider cooldown and throws.
 */
export async function ensureNonEmptyText(opts: {
  provider: string;
  model: string;
  rawText: string | null | undefined;
  plainJsonRetry: () => Promise<FallbackCallResult>;
}): Promise<string> {
  const current = (opts.rawText || "").trim();
  if (current.length > 0) return current;

  console.warn(
    `[EMPTY_FALLBACK] Empty response from ${opts.provider}/${opts.model} — attempting plain JSON retry`,
  );

  const retry = await opts.plainJsonRetry();
  const retryText = (retry?.text || "").trim();

  if (retryText.length > 0) {
    console.log(
      `[EMPTY_FALLBACK] Plain JSON retry succeeded for ${opts.provider}/${opts.model} (${retryText.length} chars)`,
    );
    return retryText;
  }

  // Both attempts failed — cooldown the provider
  await setProviderCooldown({
    provider: opts.provider,
    model: opts.model,
    ms: 180_000,
    reason: "ops_empty_response",
  });

  throw new Error("EMPTY_RESPONSE_AFTER_PLAIN_JSON_RETRY");
}
