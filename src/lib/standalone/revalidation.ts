/**
 * Standalone License Revalidation
 * 
 * Handles periodic online revalidation of standalone bundle licenses.
 * The player checks locally first (signature, expiry), then periodically
 * contacts the server to verify the license hasn't been revoked/suspended.
 * 
 * Policy: 7 days cache → revalidate → 7 days grace if offline → block
 */

// ── Types ──

export interface RevalidationState {
  licenseId: string;
  checkedAt: string;
  validUntil: string;
}

export interface RevalidationResponse {
  valid: boolean;
  reason: string;
  valid_until?: string;
  revalidate_after_days?: number;
  error?: string;
}

// ── Constants ──

const REVALIDATION_KEY = "examfit:standalone:last-revalidation";
const GRACE_PERIOD_DAYS = 7; // Additional offline grace after validUntil

// ── Revalidation Cache ──

export function loadRevalidationState(): RevalidationState | null {
  try {
    const raw = localStorage.getItem(REVALIDATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRevalidationState(state: RevalidationState): void {
  try {
    localStorage.setItem(REVALIDATION_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — continue without cache
    console.warn("[revalidation] Failed to save state to localStorage");
  }
}

export function clearRevalidationState(): void {
  try {
    localStorage.removeItem(REVALIDATION_KEY);
  } catch {
    // Ignore
  }
}

// ── Device Fingerprint ──

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createDeviceFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(screen.width),
    String(screen.height),
    String(window.devicePixelRatio),
    navigator.platform ?? "unknown",
  ];
  return sha256Hex(parts.join("|"));
}

// ── Online Revalidation ──

export async function tryOnlineRevalidation(params: {
  supabaseUrl: string;
  anonKey: string;
  licenseId: string;
}): Promise<RevalidationResponse> {
  try {
    const deviceFingerprint = await createDeviceFingerprint();

    const res = await fetch(
      `${params.supabaseUrl}/functions/v1/validate-standalone-license`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: params.anonKey,
          Authorization: `Bearer ${params.anonKey}`,
        },
        body: JSON.stringify({
          license_id: params.licenseId,
          device_fingerprint: deviceFingerprint,
        }),
        signal: AbortSignal.timeout(10000), // 10s timeout
      },
    );

    const data = await res.json();
    return data as RevalidationResponse;
  } catch {
    // Network error — fail open with offline fallback
    return {
      valid: true,
      reason: "offline_fallback",
    };
  }
}

// ── Revalidation Guard ──

export interface RevalidationResult {
  allowed: boolean;
  reason: string;
  isOnline: boolean;
  nextCheckAt?: string;
}

/**
 * Main revalidation guard. Call this on player start and periodically.
 *
 * Decision tree:
 * 1. Cache exists and still valid → allow (skip server)
 * 2. Cache expired or missing → try server
 *    a. Server says valid → update cache, allow
 *    b. Server says invalid → block
 *    c. Server unreachable → check grace period
 *       i.  Within grace → allow
 *       ii. Beyond grace → block
 */
export async function checkRevalidation(params: {
  supabaseUrl: string;
  anonKey: string;
  licenseId: string;
}): Promise<RevalidationResult> {
  const cache = loadRevalidationState();

  // Check if cache is still valid for this license
  const cacheValid =
    cache &&
    cache.licenseId === params.licenseId &&
    new Date(cache.validUntil).getTime() > Date.now();

  if (cacheValid) {
    return {
      allowed: true,
      reason: "cache_valid",
      isOnline: false,
      nextCheckAt: cache!.validUntil,
    };
  }

  // Cache expired or missing — try online revalidation
  const reval = await tryOnlineRevalidation(params);

  if (reval.reason === "offline_fallback") {
    // Server unreachable — check grace period
    if (cache && cache.licenseId === params.licenseId) {
      const graceEnd = new Date(cache.validUntil);
      graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);

      if (graceEnd.getTime() > Date.now()) {
        return {
          allowed: true,
          reason: "grace_period",
          isOnline: false,
          nextCheckAt: graceEnd.toISOString(),
        };
      }
    }

    // No cache or grace expired
    return {
      allowed: false,
      reason: "offline_grace_expired",
      isOnline: false,
    };
  }

  if (reval.valid) {
    // Server confirmed — update cache
    if (reval.valid_until) {
      saveRevalidationState({
        licenseId: params.licenseId,
        checkedAt: new Date().toISOString(),
        validUntil: reval.valid_until,
      });
    }

    return {
      allowed: true,
      reason: "server_confirmed",
      isOnline: true,
      nextCheckAt: reval.valid_until,
    };
  }

  // Server rejected
  clearRevalidationState();
  return {
    allowed: false,
    reason: reval.reason || "server_rejected",
    isOnline: true,
  };
}
