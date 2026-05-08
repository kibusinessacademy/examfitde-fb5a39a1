/**
 * Edge Auth Contract — single helper for service-role functions.
 *
 * A function is considered authorized if AT LEAST ONE is true:
 *   1. x-internal-secret OR x-job-runner-key === EDGE_INTERNAL_SHARED_SECRET
 *   2. Bearer token === SUPABASE_SERVICE_ROLE_KEY (exact, not substring)
 *   3. Bearer token belongs to a user with role='admin' in user_roles
 *
 * Forbidden patterns (caught by edge-auth-contract guard):
 *   - authHeader.includes(serviceKey)        ← substring leak risk
 *   - body.source === "ci" / "cron"          ← anyone can post that
 *   - trustedSources.includes(...)           ← string allowlist bypass
 *   - mode === "simulate" without admin gate
 *
 * On failure: writes a security_events row (best-effort) and returns 401.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

export interface EdgeAuthOk {
  ok: true;
  mode: "internal" | "service_role" | "admin_jwt";
  userId: string | null;
}
export interface EdgeAuthFail {
  ok: false;
  status: 401 | 403;
  reason: string;
}
export type EdgeAuthResult = EdgeAuthOk | EdgeAuthFail;

function constantTimeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function assertAdmin(req: Request, functionName: string): Promise<EdgeAuthResult> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";

  // 1) Internal secret (cron / scripts)
  const internalHdr = req.headers.get("x-internal-secret") ?? req.headers.get("x-job-runner-key") ?? "";
  if (internalSecret && constantTimeEq(internalHdr, internalSecret)) {
    return { ok: true, mode: "internal", userId: null };
  }

  // 2) Bearer service-role (admin tooling) — exact compare, not substring
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token && serviceKey && constantTimeEq(token, serviceKey)) {
    return { ok: true, mode: "service_role", userId: null };
  }

  // 3) Admin JWT
  if (token) {
    try {
      const anonSb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: u } = await anonSb.auth.getUser(token);
      if (u?.user?.id) {
        const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: role } = await sb.from("user_roles")
          .select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
        if (role) return { ok: true, mode: "admin_jwt", userId: u.user.id };
        await logSecurityEvent(functionName, "admin_role_missing", req);
        return { ok: false, status: 403, reason: "admin_required" };
      }
    } catch (_e) { /* fall-through */ }
  }

  await logSecurityEvent(functionName, "missing_or_invalid_auth", req);
  return { ok: false, status: 401, reason: "unauthorized" };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logSecurityEvent(functionName: string, reason: string, req: Request) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !sk) return;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ua = req.headers.get("user-agent") || "";
    const sb = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } });
    await sb.from("security_events").insert({
      event_type: "edge_auth_blocked",
      severity: "warn",
      details: {
        function_name: functionName,
        reason,
        ip_hash: ip ? (await sha256Hex(ip)).slice(0, 16) : null,
        ua_hash: ua ? (await sha256Hex(ua)).slice(0, 16) : null,
      },
    });
  } catch (_e) { /* best-effort */ }
}
