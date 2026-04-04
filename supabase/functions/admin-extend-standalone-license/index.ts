/**
 * admin-extend-standalone-license
 * Extends expiry and reactivates a license. Requires admin JWT.
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
    const { license_id, expires_at } = body;

    if (!license_id || typeof license_id !== "string") return json({ error: "Missing license_id" }, 400);
    if (!expires_at || isNaN(Date.parse(expires_at))) return json({ error: "Invalid expires_at" }, 400);

    const { data: existing, error: loadErr } = await sb
      .from("standalone_licenses")
      .select("license_id, expires_at, status")
      .eq("license_id", license_id)
      .single();

    if (loadErr || !existing) return json({ error: "License not found" }, 404);

    const { error: updErr } = await sb
      .from("standalone_licenses")
      .update({ expires_at, status: "active", updated_at: new Date().toISOString() })
      .eq("license_id", license_id);

    if (updErr) return json({ error: updErr.message }, 500);

    await sb.from("standalone_license_events").insert({
      license_id,
      event_type: "expiry_extended",
      event_status: "ok",
      detail: { previous_expires_at: existing.expires_at, next_expires_at: expires_at, previous_status: existing.status, actor: userId },
    });

    console.log(`[extend-license] ${license_id} exp=${expires_at} by=${userId}`);
    return json({ ok: true, license_id, expires_at });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[extend-license] Fatal:", msg);
    return json({ error: msg }, 500);
  }
});
