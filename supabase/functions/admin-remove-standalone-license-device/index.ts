/**
 * admin-remove-standalone-license-device
 * Removes a specific device from a license. Requires admin JWT.
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
    const { license_id, device_fingerprint } = body;

    if (!license_id || typeof license_id !== "string") return json({ error: "Missing license_id" }, 400);
    if (!device_fingerprint || typeof device_fingerprint !== "string" || device_fingerprint.length < 8) {
      return json({ error: "Invalid device_fingerprint" }, 400);
    }

    const { error } = await sb
      .from("standalone_license_devices")
      .delete()
      .eq("license_id", license_id)
      .eq("device_fingerprint", device_fingerprint);

    if (error) return json({ error: error.message }, 500);

    await sb.from("standalone_license_events").insert({
      license_id,
      event_type: "device_removed",
      event_status: "ok",
      detail: { device_fingerprint, actor: userId },
    });

    console.log(`[device-remove] ${license_id} fp=${device_fingerprint.slice(0, 8)}… by=${userId}`);
    return json({ ok: true, license_id, device_fingerprint });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[device-remove] Fatal:", msg);
    return json({ error: msg }, 500);
  }
});
