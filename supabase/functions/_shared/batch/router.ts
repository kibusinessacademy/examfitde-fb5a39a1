/**
 * Provider router — returns the correct BatchProviderAdapter.
 * Phase A: OpenAI only. Phase C: Anthropic adapter plugs in here.
 */
import type { BatchProvider, BatchProviderAdapter } from "./types.ts";
import { openAIBatchAdapter } from "./openai.ts";

export function getBatchAdapter(provider: BatchProvider): BatchProviderAdapter {
  switch (provider) {
    case "openai":
      return openAIBatchAdapter;
    case "anthropic":
      throw new Error(
        "Anthropic batch adapter not yet implemented — Phase C",
      );
    default:
      throw new Error(`Unsupported batch provider: ${provider}`);
  }
}
