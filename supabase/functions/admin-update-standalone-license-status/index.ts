/**
 * admin-update-standalone-license-status
 * Changes license status with audit event. Requires admin JWT.
 */
import { handleCors, json, requireAdmin } from "../_shared/adminGuard.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { sb, userId } = auth;

    const body = await req.json();
    const { license_id, next_status, reason = null } = body;

    if (!license_id || typeof license_id !== "string") {
      return json({ error: "Missing license_id" }, 400);
    }
    if (!["active", "revoked", "suspended", "expired"].includes(next_status)) {
      return json({ error: "Invalid next_status" }, 400);
    }

    const { data: existing, error: loadErr } = await sb
      .from("standalone_licenses")
      .select("license_id, status")
      .eq("license_id", license_id)
      .single();

    if (loadErr || !existing) return json({ error: "License not found" }, 404);

    const { error: updateErr } = await sb
      .from("standalone_licenses")
      .update({ status: next_status, updated_at: new Date().toISOString() })
      .eq("license_id", license_id);

    if (updateErr) return json({ error: updateErr.message }, 500);

    const eventMap: Record<string, string> = {
      revoked: "revoked",
      suspended: "suspended",
      active: "reactivated",
      expired: "expired",
    };

    await sb.from("standalone_license_events").insert({
      license_id,
      event_type: eventMap[next_status] || "validated",
      event_status: "ok",
      detail: { previous_status: existing.status, next_status, reason, actor: userId },
    });

    return json({ ok: true, license_id, previous_status: existing.status, next_status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});
