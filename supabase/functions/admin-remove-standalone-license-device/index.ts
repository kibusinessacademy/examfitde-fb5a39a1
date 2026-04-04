/**
 * admin-remove-standalone-license-device
 *
 * Removes a specific device from a license's device list.
 * Input: { license_id, device_fingerprint, actor? }
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
    const { license_id, device_fingerprint, actor = "admin" } = body;

    if (!license_id || !device_fingerprint) {
      return json({ error: "Missing license_id or device_fingerprint" }, 400);
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
      detail: {
        device_fingerprint,
        actor,
      },
    });

    console.log(
      `[device-remove] ${license_id} fp=${device_fingerprint.slice(0, 8)}… by=${actor}`,
    );

    return json({ ok: true, license_id, device_fingerprint });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[device-remove] Fatal:", message);
    return json({ error: message }, 500);
  }
});
