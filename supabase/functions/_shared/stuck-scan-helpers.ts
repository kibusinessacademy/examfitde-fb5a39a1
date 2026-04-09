/**
 * stuck-scan shared helpers: utility functions, types, and constants.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export type SupabaseClient = ReturnType<typeof createClient>;

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function isPermanentStepFailure(step: any): boolean {
  const meta = (step?.meta ?? {}) as Record<string, unknown>;
  const cls = String(meta?.last_error_class ?? "");
  if (cls === "permanent") return true;
  const kind = String(meta?.last_error_kind ?? "");
  if (["check_violation", "not_null_violation", "foreign_key_violation", "rls_denied", "unique_violation"].includes(kind)) return true;
  const lastErr = String(step?.last_error ?? "");
  if (lastErr.toUpperCase().includes("SSOT_GUARD")) return true;
  if (lastErr.toUpperCase().includes("HTTP 422 PERMANENT")) return true;
  return false;
}

// ═══════════════════════════════════════════════════════
//  SSOT: Centralized Terminal Retry Loop Detection
// ═══════════════════════════════════════════════════════
// All watchers, scanners, and healers MUST use these
// functions instead of ad-hoc loop detection.
// ═══════════════════════════════════════════════════════

/** Known terminal error patterns that indicate a job is in an unrecoverable loop. */
const TERMINAL_LOOP_PATTERNS = [
  "STALE_LOCK_RECOVERY",
  "STALE_LOCK_LOOP_COOLDOWN",
  "STALE_LOCK_EXHAUSTED",
  "LOOP_KILLED",
  "ZOMBIE_TERMINAL_FAIL",
  "LOCK_CHURN",
] as const;

/** Minimum attempts before a job qualifies as a terminal retry loop. */
const TERMINAL_LOOP_MIN_ATTEMPTS = 4;

/**
 * Determines whether a job is in a terminal retry loop —
 * i.e., it will never complete successfully and should not
 * block step finalization or be counted as "genuinely active."
 *
 * This is the SSOT function. All stuck-scan, watchdog, and
 * healer code MUST call this instead of inline checks.
 */
export function isTerminalRetryLoop(job: {
  attempts?: number | null;
  last_error?: string | null;
  status?: string | null;
}): boolean {
  const attempts = job.attempts ?? 0;
  const lastError = String(job.last_error ?? "");

  // Pattern match: known loop signatures with sufficient attempts
  if (attempts >= TERMINAL_LOOP_MIN_ATTEMPTS) {
    for (const pattern of TERMINAL_LOOP_PATTERNS) {
      if (lastError.includes(pattern)) return true;
    }
  }

  // High-attempt jobs with repeated 5xx errors (no state change)
  if (attempts >= 8 && lastError.startsWith("HTTP 5")) return true;

  // Reclaim exhaustion
  if (attempts >= 10) return true;

  return false;
}

/**
 * Filters a list of jobs to only those that are genuinely active
 * (i.e., NOT in a terminal retry loop). Use this to decide
 * whether a step can be finalized despite having "active" jobs.
 */
export function filterGenuinelyActiveJobs<T extends {
  attempts?: number | null;
  last_error?: string | null;
  status?: string | null;
}>(jobs: T[]): { active: T[]; terminal: T[] } {
  const active: T[] = [];
  const terminal: T[] = [];
  for (const j of jobs) {
    if (isTerminalRetryLoop(j)) {
      terminal.push(j);
    } else {
      active.push(j);
    }
  }
  return { active, terminal };
}

export async function safeRpc(
  sb: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[stuck-scan] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[stuck-scan] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
  }
}
