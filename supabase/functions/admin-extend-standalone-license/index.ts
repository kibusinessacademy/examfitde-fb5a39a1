/**
 * admin-extend-standalone-license
 *
 * Extends the expiry date of a standalone license and reactivates it.
 * Input: { license_id, expires_at, actor? }
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
    const { license_id, expires_at, actor = "admin" } = body;

    if (!license_id || !expires_at) {
      return json({ error: "Missing license_id or expires_at" }, 400);
    }

    const { data: existing, error: loadErr } = await sb
      .from("standalone_licenses")
      .select("license_id, expires_at, status")
      .eq("license_id", license_id)
      .single();

    if (loadErr || !existing) {
      return json({ error: "License not found" }, 404);
    }

    const { error: updErr } = await sb
      .from("standalone_licenses")
      .update({
        expires_at,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("license_id", license_id);

    if (updErr) {
      return json({ error: updErr.message }, 500);
    }

    await sb.from("standalone_license_events").insert({
      license_id,
      event_type: "expiry_extended",
      event_status: "ok",
      detail: {
        previous_expires_at: existing.expires_at,
        next_expires_at: expires_at,
        previous_status: existing.status,
        actor,
      },
    });

    console.log(
      `[extend-license] ${license_id} exp=${expires_at} by=${actor}`,
    );

    return json({ ok: true, license_id, expires_at });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[extend-license] Fatal:", message);
    return json({ error: message }, 500);
  }
});
