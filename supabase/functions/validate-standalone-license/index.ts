/**
 * validate-standalone-license
 *
 * Online revalidation endpoint for the standalone player.
 * Checks license status, expiry, and device limits.
 * Called periodically (every 7 days) by the player.
 *
 * Input: { license_id, device_fingerprint? }
 * Output: { valid, reason, valid_until?, revalidate_after_days? }
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const REVALIDATION_WINDOW_DAYS = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { license_id, device_fingerprint } = body;

    if (!license_id) {
      return json({ error: "Missing license_id" }, 400);
    }

    // ── 1. Load license ──
    const { data: license, error } = await sb
      .from("standalone_licenses")
      .select("*")
      .eq("license_id", license_id)
      .single();

    if (error || !license) {
      return json({ valid: false, reason: "license_not_found" }, 404);
    }

    // ── 2. Status checks ──
    if (license.status === "revoked") {
      await logEvent(sb, license_id, "validated", "failed", { reason: "license_revoked", device_fingerprint });
      return json({ valid: false, reason: "license_revoked" }, 403);
    }

    if (license.status === "suspended") {
      await logEvent(sb, license_id, "validated", "failed", { reason: "license_suspended", device_fingerprint });
      return json({ valid: false, reason: "license_suspended" }, 403);
    }

    // ── 3. Expiry check ──
    const now = new Date();
    const expiresAt = new Date(license.expires_at);

    if (expiresAt.getTime() <= now.getTime()) {
      // Auto-expire
      await sb
        .from("standalone_licenses")
        .update({ status: "expired", updated_at: now.toISOString() })
        .eq("license_id", license_id);

      await logEvent(sb, license_id, "expired", "ok", {});

      return json({ valid: false, reason: "license_expired" }, 403);
    }

    // ── 4. Device fingerprint handling ──
    if (device_fingerprint) {
      const { data: knownDevices } = await sb
        .from("standalone_license_devices")
        .select("*")
        .eq("license_id", license_id);

      const devices = knownDevices || [];
      const existingDevice = devices.find(
        (d: Record<string, unknown>) => d.device_fingerprint === device_fingerprint,
      );

      if (!existingDevice) {
        // New device — check limit
        if (devices.length >= license.device_limit) {
          await logEvent(sb, license_id, "validated", "failed", {
            reason: "device_limit_exceeded",
            device_fingerprint,
            known_device_count: devices.length,
            device_limit: license.device_limit,
          });

          return json({ valid: false, reason: "device_limit_exceeded" }, 403);
        }

        // Register new device
        await sb.from("standalone_license_devices").insert({
          license_id,
          device_fingerprint,
          metadata: {},
        });

        await logEvent(sb, license_id, "device_registered", "ok", { device_fingerprint });
      } else {
        // Update last_seen
        await sb
          .from("standalone_license_devices")
          .update({ last_seen_at: now.toISOString(), updated_at: now.toISOString() })
          .eq("license_id", license_id)
          .eq("device_fingerprint", device_fingerprint);
      }
    }

    // ── 5. Update license timestamps ──
    await sb
      .from("standalone_licenses")
      .update({
        last_validated_at: now.toISOString(),
        last_opened_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("license_id", license_id);

    // ── 6. Log success ──
    await logEvent(sb, license_id, "validated", "ok", {
      device_fingerprint: device_fingerprint || null,
    });

    // ── 7. Return validity window ──
    const validUntil = new Date(
      now.getTime() + REVALIDATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    return json({
      valid: true,
      reason: "ok",
      valid_until: validUntil,
      revalidate_after_days: REVALIDATION_WINDOW_DAYS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[validate-license] Fatal:", message);
    // Fail-open for network errors: player continues offline
    return json({ error: message }, 500);
  }
});

async function logEvent(
  sb: ReturnType<typeof createClient>,
  licenseId: string,
  eventType: string,
  eventStatus: string,
  detail: Record<string, unknown>,
) {
  try {
    await sb.from("standalone_license_events").insert({
      license_id: licenseId,
      event_type: eventType,
      event_status: eventStatus,
      detail,
    });
  } catch (e) {
    console.warn("[validate-license] Failed to log event:", e);
  }
}
