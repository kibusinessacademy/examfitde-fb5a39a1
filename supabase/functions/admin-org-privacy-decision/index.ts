import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { isUuid, clampInt, clampStr } from "../_shared/org_privacy.ts";

serve(async (req) => {
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
    const jwtToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwtToken) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwtToken);
    const adminId = u?.user?.id;
    if (!adminId) return json(401, { error: "Invalid token" }, origin);

    // Admin gate: has_role(_user_id, _role) with app_role enum
    const { data: isAdmin, error: aErr } = await supabase.rpc("has_role", {
      _user_id: adminId,
      _role: "admin",
    });
    if (aErr) return json(500, { error: "admin_check_failed", details: aErr.message }, origin);
    if (!isAdmin) return json(403, { error: "Admin only" }, origin);

    const body = await req.json().catch(() => ({}));
    const orgId = isUuid(body.organization_id) ? body.organization_id : null;
    if (!orgId) return json(400, { error: "Missing/invalid organization_id" }, origin);

    const decision = (body.decision ?? "").toString().toUpperCase();
    if (!["APPROVE", "DENY", "REVOKE"].includes(decision)) {
      return json(400, { error: "decision must be APPROVE|DENY|REVOKE" }, origin);
    }

    const days = clampInt(String(body.days ?? "30"), 30, 1, 365);
    const notes = clampStr(body.admin_notes, 800);

    let update: Record<string, unknown> = {
      organization_id: orgId,
      approved_by: adminId,
      approved_at: new Date().toISOString(),
      admin_notes: notes ?? null,
    };

    if (decision === "APPROVE") {
      const until = new Date();
      until.setUTCDate(until.getUTCDate() + days);
      update = {
        ...update,
        status: "APPROVED",
        scope: "IDENTIFIED",
        approved_until: until.toISOString(),
      };
    } else if (decision === "DENY") {
      update = {
        ...update,
        status: "DENIED",
        scope: "ANONYMIZED",
        approved_until: null,
      };
    } else {
      // REVOKE
      update = {
        ...update,
        status: "EXPIRED",
        scope: "ANONYMIZED",
        approved_until: null,
      };
    }

    const { data, error } = await supabase
      .from("org_privacy_access")
      .upsert(update, { onConflict: "organization_id" })
      .select("organization_id, status, scope, approved_until, requested_at, approved_at")
      .maybeSingle();

    if (error) return json(500, { error: "update_failed", details: error.message }, origin);

    return json(200, { ok: true, privacy: data }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
