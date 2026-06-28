/**
 * internal-auth.ts — gemeinsamer Auth-Helper für interne/Cron-Aufrufe
 *
 * Akzeptiert zwei Pfade:
 *   1. Gültiger User-JWT (für UI-Aufrufe / Admin-Panel)
 *   2. Header `x-internal-secret == INTERNAL_CRON_SECRET` (für pg_cron / Service-Role)
 *      (Alias: `x-cron-secret` für Rückwärtskompatibilität)
 *
 * Verwendung:
 *   const auth = await requireInternalOrUser(req);
 *   if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
 *   // auth.kind === "internal" → System-Call, kein User
 *   // auth.kind === "user"     → auth.userId verfügbar
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const INTERNAL_SECRET =
  Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

export type AuthResult =
  | { ok: true; kind: "internal" }
  | { ok: true; kind: "user"; userId: string; email?: string }
  | { ok: false; status: number; error: string };

export async function requireInternalOrUser(req: Request): Promise<AuthResult> {
  // 1) Internal secret path
  const provided =
    req.headers.get("x-internal-secret") ??
    req.headers.get("x-cron-secret") ??
    "";
  if (INTERNAL_SECRET && provided && provided === INTERNAL_SECRET) {
    return { ok: true, kind: "internal" };
  }

  // 2) User JWT path
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "missing_authorization" };
  }
  const token = authHeader.replace("Bearer ", "");

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await sb.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return { ok: false, status: 401, error: "invalid_jwt" };
    }
    return {
      ok: true,
      kind: "user",
      userId: data.claims.sub as string,
      email: (data.claims.email as string | undefined) ?? undefined,
    };
  } catch (_e) {
    return { ok: false, status: 401, error: "auth_check_failed" };
  }
}
