/**
 * revoke-standalone-license
 *
 * Revokes, suspends, or reactivates a standalone license. Logs the event for audit.
 * Requires authenticated admin user (checked via JWT + user_roles).
 *
 * Input: { license_id, reason?, action?: 'revoke'|'suspend'|'reactivate', actor? }
 * Output: { ok, license_id, status }
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

async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error } = await sb.auth.getClaims(token);
  if (error || !claims?.claims?.sub) {
    return json({ error: "Unauthorized" }, 401);
  }

  const userId = claims.claims.sub as string;

  const serviceSb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: roles } = await serviceSb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");

  if (!roles || roles.length === 0) {
    return json({ error: "Admin access required" }, 403);
  }

  return { userId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      license_id,
      reason = "manual_revoke",
      action = "revoke",
      actor = authResult.userId,
    } = body;

    if (!license_id) {
      return json({ error: "Missing license_id" }, 400);
    }

    if (!["revoke", "suspend", "reactivate"].includes(action)) {
      return json({ error: "Invalid action. Must be: revoke, suspend, or reactivate" }, 400);
    }

    const statusMap: Record<string, string> = {
      revoke: "revoked",
      suspend: "suspended",
      reactivate: "active",
    };
    const newStatus = statusMap[action];

    const { data: license, error: licErr } = await sb
      .from("standalone_licenses")
      .select("license_id, status")
      .eq("license_id", license_id)
      .single();

    if (licErr || !license) {
      return json({ error: "License not found" }, 404);
    }

    if (action === "reactivate" && license.status === "revoked" && !reason) {
      return json({ error: "Reactivating a revoked license requires a reason" }, 400);
    }

    const { error: updErr } = await sb
      .from("standalone_licenses")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("license_id", license_id);

    if (updErr) {
      return json({ error: updErr.message }, 500);
    }

    await sb.from("standalone_license_events").insert({
      license_id,
      event_type: action === "reactivate" ? "reactivated" : action === "suspend" ? "suspended" : "revoked",
      event_status: "ok",
      detail: {
        reason,
        actor,
        previous_status: license.status,
      },
    });

    console.log(`[revoke-license] license=${license_id} action=${action} new_status=${newStatus} by=${actor}`);

    return json({ ok: true, license_id, status: newStatus });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[revoke-license] Fatal:", message);
    return json({ error: message }, 500);
  }
});
