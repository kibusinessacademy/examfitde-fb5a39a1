/**
 * lesson-gen/constants.ts — Static configuration constants
 * Single source of truth for time budgets, token clamps, and limits.
 */

export const PLATFORM_HARD_LIMIT_MS = 55_000;
export const MIN_LLM_BUDGET_MS = 15_000;
export const MIN_PERSIST_MS = 4_000;
export const MIN_CHECKPOINT_MS = 1_000;
export const TOKEN_CLAMP_LESSON = 3200;
export const TOKEN_CLAMP_MINICHECK = 2400;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "content-type": "application/json",
};
