/**
 * Resolve credentials for E2E tests.
 *
 * Two paths are supported:
 *  1) Direct service-role key (via aliases — Lovable sandbox blocks SUPABASE_*).
 *  2) Edge-function proxy `e2e-test-helper`, gated by E2E_HELPER_TOKEN.
 *
 * Specs SHOULD prefer `e2eHelper(...)` over the bare service key — it removes
 * the "service key in test runner" footgun entirely.
 */
export const SERVICE_KEY: string =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SR_KEY ||
  process.env.SRK_E2E ||
  process.env.SR_KEY ||
  "";

export const SUPABASE_URL: string =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

export const HELPER_TOKEN: string =
  process.env.E2E_HELPER_TOKEN ||
  process.env.E2E_TEST_HELPER_TOKEN ||
  "";

/** True if either the helper proxy OR a service-role key is available. */
export const HAS_ADMIN_PATH = Boolean(
  SUPABASE_URL && (HELPER_TOKEN || SERVICE_KEY),
);

type HelperOp =
  | { op: "ping" }
  | { op: "sellable_courses" }
  | { op: "create_test_grant"; course_id: string; email: string; reason?: string };

/**
 * Call the e2e-test-helper edge function. Falls back to direct service-role RPC
 * when no helper token is configured but a service key is.
 */
export async function e2eHelper<T = any>(payload: HelperOp): Promise<T> {
  if (!SUPABASE_URL) throw new Error("VITE_SUPABASE_URL not set");

  if (HELPER_TOKEN) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/e2e-test-helper`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HELPER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`e2e-test-helper ${payload.op} → ${r.status}: ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : (null as T);
  }

  // ── Fallback: direct service-role RPC (legacy path) ──────────────
  if (!SERVICE_KEY) {
    throw new Error(
      "Neither E2E_HELPER_TOKEN nor a service-role key alias is set — cannot run admin path",
    );
  }
  const rpc = async (name: string, body: Record<string, unknown>) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${name} → ${r.status}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };

  if (payload.op === "ping") return { ok: true } as unknown as T;
  if (payload.op === "sellable_courses") {
    const courses = await rpc("public_sellable_courses", {});
    return { ok: true, courses } as unknown as T;
  }
  if (payload.op === "create_test_grant") {
    const grant = await rpc("admin_create_test_purchase_grant", {
      _course_id: payload.course_id,
      _user_email: payload.email,
      _reason: payload.reason ?? "e2e",
    });
    return { ok: true, grant } as unknown as T;
  }
  throw new Error(`Unknown helper op`);
}
