/**
 * revoke-standalone-license
 * Revokes, suspends, or reactivates a standalone license. Requires admin JWT.
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
    const { license_id, reason = "manual_revoke", action = "revoke" } = body;

    if (!license_id || typeof license_id !== "string") return json({ error: "Missing license_id" }, 400);
    if (!["revoke", "suspend", "reactivate"].includes(action)) {
      return json({ error: "Invalid action" }, 400);
    }

    const statusMap: Record<string, string> = { revoke: "revoked", suspend: "suspended", reactivate: "active" };
    const newStatus = statusMap[action];

    const { data: license, error: licErr } = await sb
      .from("standalone_licenses")
      .select("license_id, status")
      .eq("license_id", license_id)
      .single();

    if (licErr || !license) return json({ error: "License not found" }, 404);

    if (action === "reactivate" && license.status === "revoked" && !reason) {
      return json({ error: "Reactivating a revoked license requires a reason" }, 400);
    }

    const { error: updErr } = await sb
      .from("standalone_licenses")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("license_id", license_id);

    if (updErr) return json({ error: updErr.message }, 500);

    await sb.from("standalone_license_events").insert({
      license_id,
      event_type: action === "reactivate" ? "reactivated" : action === "suspend" ? "suspended" : "revoked",
      event_status: "ok",
      detail: { reason, actor: userId, previous_status: license.status },
    });

    console.log(`[revoke-license] ${license_id} action=${action} by=${userId}`);
    return json({ ok: true, license_id, status: newStatus });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[revoke-license] Fatal:", msg);
    return json({ error: msg }, 500);
  }
});
