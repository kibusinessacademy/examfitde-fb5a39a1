/**
 * admin-read-standalone-licenses
 *
 * Returns license list, devices, events, or risk board depending on `view` param.
 * All reads go through service_role — views stay private.
 */
import { handleCors, json, requireAdmin } from "../_shared/adminGuard.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { sb } = auth;

    const body = await req.json().catch(() => ({}));
    const view: string = body.view ?? "licenses";

    switch (view) {
      /* ── License list ── */
      case "licenses": {
        const { data, error } = await sb
          .from("v_admin_standalone_licenses")
          .select("*")
          .order("issued_at", { ascending: false })
          .limit(500);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, data });
      }

      /* ── Devices for a single license ── */
      case "devices": {
        const licenseId = body.license_id;
        if (!licenseId || typeof licenseId !== "string") {
          return json({ error: "Missing license_id" }, 400);
        }
        const { data, error } = await sb
          .from("v_admin_standalone_license_devices")
          .select("*")
          .eq("license_id", licenseId)
          .order("first_seen_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, data });
      }

      /* ── Events for a single license ── */
      case "events": {
        const licenseId = body.license_id;
        if (!licenseId || typeof licenseId !== "string") {
          return json({ error: "Missing license_id" }, 400);
        }
        const { data, error } = await sb
          .from("v_admin_standalone_license_events")
          .select("*")
          .eq("license_id", licenseId)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, data });
      }

      /* ── Risk board ── */
      case "risk": {
        const { data, error } = await sb
          .from("v_admin_standalone_license_risk")
          .select("*")
          .order("last_seen_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, data });
      }

      default:
        return json({ error: `Unknown view: ${view}` }, 400);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin-read-licenses]", msg);
    return json({ error: msg }, 500);
  }
});
