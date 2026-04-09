// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

function json(status: number, data: unknown, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" }, origin);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const body = await req.json().catch(() => ({}));

    const organization_id = isUuid(body.organization_id) ? body.organization_id : null;
    const learner_user_id = isUuid(body.learner_user_id) ? body.learner_user_id : null;
    if (!organization_id || !learner_user_id) return json(400, { error: "Missing organization_id / learner_user_id" }, origin);

    // Verify OWNER or MANAGER role (SSOT: org_memberships)
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", organization_id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
      return json(403, { error: "Requires OWNER or MANAGER role" }, origin);
    }

    const entity_id = isUuid(body.entity_id) ? body.entity_id : null;

    // Upsert learner link
    const { data: learner, error: lErr } = await supabase
      .from("organization_learners")
      .upsert({
        organization_id,
        learner_user_id,
        entity_id,
        joined_at: new Date().toISOString(),
        left_at: null,
      }, { onConflict: "organization_id,learner_user_id" })
      .select("id, organization_id, learner_user_id, entity_id, joined_at")
      .maybeSingle();

    if (lErr) return json(500, { error: "learner_upsert_failed", details: lErr.message }, origin);

    // Optionally create a seat if product/certification provided
    let seat = null;
    if (isUuid(body.product_id) || isUuid(body.certification_id)) {
      const { data: s, error: sErr } = await supabase
        .from("organization_seats")
        .upsert({
          organization_id,
          entity_id,
          learner_user_id,
          product_id: isUuid(body.product_id) ? body.product_id : null,
          certification_id: isUuid(body.certification_id) ? body.certification_id : null,
          seat_status: "INVITED",
          start_at: body.start_at ?? null,
          end_at: body.end_at ?? null,
          notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null,
        }, { onConflict: "organization_id,learner_user_id,product_id" })
        .select("id, seat_status, product_id, certification_id")
        .maybeSingle();

      if (!sErr) seat = s;
    }

    return json(200, { ok: true, learner, seat }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
