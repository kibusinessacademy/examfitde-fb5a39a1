/**
 * Edge Function Security Middleware
 * - Rate limiting (DB-backed via check_rate_limit RPC)
 * - Idempotency (replay protection via use_idempotency_key RPC)
 * - Security event logging
 * - Input validation helpers
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SupabaseAdmin = ReturnType<typeof createClient>;

// ── Rate Limiting ──────────────────────────────────────────────────

export interface RateLimitConfig {
  windowSeconds?: number;
  maxRequests?: number;
}

const RATE_LIMIT_DEFAULTS: Record<string, RateLimitConfig> = {
  "submit-exam-answer": { windowSeconds: 60, maxRequests: 60 },
  "get-exam-session-questions": { windowSeconds: 60, maxRequests: 30 },
  "export-course-package": { windowSeconds: 3600, maxRequests: 3 },
  "ai-tutor": { windowSeconds: 60, maxRequests: 20 },
  "oral-exam-evaluate": { windowSeconds: 60, maxRequests: 15 },
  "create-exam-session": { windowSeconds: 60, maxRequests: 10 },
  default: { windowSeconds: 60, maxRequests: 30 },
};

/**
 * Check rate limit for a user+endpoint combination.
 * Returns true if allowed, false if blocked.
 * Logs security event on block.
 */
export async function checkRateLimit(
  admin: SupabaseAdmin,
  userId: string,
  endpoint: string,
  config?: RateLimitConfig,
): Promise<boolean> {
  const defaults = RATE_LIMIT_DEFAULTS[endpoint] || RATE_LIMIT_DEFAULTS.default;
  const windowSeconds = config?.windowSeconds ?? defaults.windowSeconds ?? 60;
  const maxRequests = config?.maxRequests ?? defaults.maxRequests ?? 30;
  const userKey = `${userId}:${endpoint}`;

  try {
    const { data: allowed, error } = await admin.rpc("check_rate_limit", {
      p_user_key: userKey,
      p_window_seconds: windowSeconds,
      p_max_requests: maxRequests,
    });

    if (error) {
      console.warn("[SECURITY] Rate limit check failed, allowing request:", error.message);
      return true; // Fail open to avoid blocking legitimate users
    }

    if (!allowed) {
      // Log the block
      await logSecurityEvent(admin, "RATE_LIMIT_BLOCK", userId, endpoint, {
        window_seconds: windowSeconds,
        max_requests: maxRequests,
      });
    }

    return !!allowed;
  } catch (e) {
    console.warn("[SECURITY] Rate limit error:", e);
    return true; // Fail open
  }
}

// ── Idempotency ──────────────────────────────────────────────────

/**
 * Check and reserve an idempotency key.
 * Returns cached response JSON if key was already used, null if new.
 */
export async function checkIdempotency(
  admin: SupabaseAdmin,
  idempotencyKey: string,
  userId: string,
  endpoint: string,
): Promise<Record<string, unknown> | null> {
  if (!idempotencyKey) return null;

  try {
    const { data, error } = await admin.rpc("use_idempotency_key", {
      p_key: idempotencyKey,
      p_user_id: userId,
      p_endpoint: endpoint,
    });

    if (error) {
      console.warn("[SECURITY] Idempotency check failed:", error.message);
      return null;
    }

    return data as Record<string, unknown> | null;
  } catch (e) {
    console.warn("[SECURITY] Idempotency error:", e);
    return null;
  }
}

/**
 * Store the response for an idempotency key after processing.
 */
export async function setIdempotencyResponse(
  admin: SupabaseAdmin,
  idempotencyKey: string,
  endpoint: string,
  response: Record<string, unknown>,
): Promise<void> {
  if (!idempotencyKey) return;

  try {
    await admin.rpc("set_idempotency_response", {
      p_key: idempotencyKey,
      p_endpoint: endpoint,
      p_response: response,
    });
  } catch (e) {
    console.warn("[SECURITY] Failed to set idempotency response:", e);
  }
}

// ── Security Event Logging ──────────────────────────────────────

/**
 * Log a security event (rate limit blocks, auth failures, suspicious activity).
 */
export async function logSecurityEvent(
  admin: SupabaseAdmin,
  eventType: string,
  userId?: string | null,
  endpoint?: string | null,
  metadata?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await admin.rpc("log_security_event", {
      p_event_type: eventType,
      p_user_id: userId || null,
      p_endpoint: endpoint || null,
      p_metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (e) {
    // Never let logging fail the request
    console.warn("[SECURITY] Failed to log event:", e);
  }
}

// ── Convenience: Rate Limit Response ──

import { getCorsHeaders } from "./cors.ts";

export function rateLimitResponse(origin: string | null): Response {
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
    {
      status: 429,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}
