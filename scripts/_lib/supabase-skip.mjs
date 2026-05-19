/**
 * Shared Supabase Skip-Helper
 * ────────────────────────────
 * Einheitliche Behandlung für CI-Scripts, die einen privilegierten
 * Supabase-Zugriff (Service-Role-Key) brauchen, aber tolerieren müssen,
 * dass dieser Key in manchen Umgebungen (PRs aus Forks, Lovable-Sandbox,
 * lokale Smoke-Runs) fehlt oder nicht ausreichend privilegiert ist.
 *
 * Verhalten:
 *   - SUPABASE_URL fehlt / KEY fehlt → log GitHub-Warning + exit(0)
 *   - REST/RPC liefert 401/403 / "forbidden" / "JWT" / "P0001" → skip
 *
 * Verwendung:
 *
 *   import { resolveSupabaseEnv, isAuthConfigError, skipWithWarning }
 *     from "./_lib/supabase-skip.mjs";
 *
 *   const env = resolveSupabaseEnv({ requireServiceKey: true, scriptName: "lxi-heal-smoke" });
 *   if (env.skip) process.exit(0);     // already logged the warning
 *
 *   try { …rpc… }
 *   catch (e) {
 *     if (isAuthConfigError(e)) return skipWithWarning("phase1 rpc", e, "lxi-heal-smoke");
 *     throw e;
 *   }
 */

const G = "\x1b[32m", Y = "\x1b[33m", R = "\x1b[31m", D = "\x1b[2m", X = "\x1b[0m";

/** True, wenn der Prozess in GitHub Actions läuft. */
export const IN_CI = process.env.GITHUB_ACTIONS === "true";

/**
 * Emit `::warning::` line if in CI, plus a friendly stderr line otherwise.
 * Never throws.
 */
export function ciWarn(message) {
  if (IN_CI) console.log(`::warning::${message}`);
  console.warn(`${Y}⏭️  ${message}${X}`);
}

/**
 * Auflösung der Supabase-Env-Vars mit allen üblichen Aliassen.
 * @param {{ requireServiceKey?: boolean, scriptName?: string, allowAnonFallback?: boolean }} opts
 * @returns {{ url: string|null, anonKey: string|null, serviceKey: string|null, key: string|null, skip: boolean, reason: string|null }}
 */
export function resolveSupabaseEnv(opts = {}) {
  const { requireServiceKey = false, scriptName = "supabase-check", allowAnonFallback = true } = opts;

  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    null;

  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SR_KEY ||
    process.env.SRK_E2E ||
    process.env.SR_KEY ||
    null;

  // Effective "key" used by the script for REST calls
  const key = requireServiceKey
    ? (serviceKey || (allowAnonFallback ? null : null)) // service-role-only paths must NOT silently use anon
    : (serviceKey || anonKey);

  let skip = false;
  let reason = null;

  if (!url) {
    reason = `${scriptName} skipped: SUPABASE_URL / VITE_SUPABASE_URL not set`;
    skip = true;
  } else if (requireServiceKey && !serviceKey) {
    reason = `${scriptName} skipped: SUPABASE_SERVICE_ROLE_KEY not available in this environment`;
    skip = true;
  } else if (!requireServiceKey && !key) {
    reason = `${scriptName} skipped: no Supabase key (service-role or publishable) available`;
    skip = true;
  }

  if (skip) ciWarn(reason);

  return { url, anonKey, serviceKey, key, skip, reason };
}

/**
 * Erkennt API-Antworten / Errors, die auf fehlende Berechtigung deuten —
 * statt das Script rot zu markieren, sollten Aufrufer auf Skip wechseln.
 */
export function isAuthConfigError(err) {
  if (!err) return false;
  if (typeof err === "number") return err === 401 || err === 403;
  const msg = `${err?.message || err?.error || err || ""} ${err?.code || ""}`.toLowerCase();
  return (
    msg.includes("forbidden") ||
    msg.includes("unauthorized") ||
    msg.includes("invalid api key") ||
    msg.includes("invalid jwt") ||
    msg.includes("jwt expired") ||
    msg.includes("jwt ") ||
    msg.includes("p0001") ||
    msg.includes("permission denied")
  );
}

/** True für HTTP-Status-Codes, die als Auth-Skip behandelt werden sollen. */
export function isAuthStatus(status) {
  return status === 401 || status === 403;
}

/**
 * Convenience: Warning loggen + caller darf weiter laufen oder process.exit(0) machen.
 */
export function skipWithWarning(label, err, scriptName = "supabase-check") {
  const detail = err?.message ? `: ${err.message}` : err ? `: ${String(err).slice(0, 200)}` : "";
  ciWarn(`${scriptName} → ${label} skipped (auth/privilege not available)${detail}`);
}

export const COLORS = { G, Y, R, D, X };
