/**
 * admin-update-standalone-license-status
 *
 * Changes the status of a standalone license and logs an audit event.
 * Requires authenticated admin user (JWT + user_roles).
 * Input: { license_id, next_status, reason?, actor? }
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
      next_status,
      reason = null,
      actor = authResult.userId,
    } = body;

    if (!license_id || !next_status) {
      return json({ error: "Missing license_id or next_status" }, 400);
    }

    if (!["active", "revoked", "suspended", "expired"].includes(next_status)) {
      return json({ error: "Invalid next_status" }, 400);
    }

    const { data: existing, error: loadErr } = await sb
      .from("standalone_licenses")
      .select("license_id, status")
      .eq("license_id", license_id)
      .single();

    if (loadErr || !existing) {
      return json({ error: "License not found" }, 404);
    }

    const { error: updateErr } = await sb
      .from("standalone_licenses")
      .update({
        status: next_status,
        updated_at: new Date().toISOString(),
      })
      .eq("license_id", license_id);

    if (updateErr) {
      return json({ error: updateErr.message }, 500);
    }

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
      detail: {
        previous_status: existing.status,
        next_status,
        reason,
        actor,
      },
    });

    console.log(
      `[license-status] ${license_id} ${existing.status}→${next_status} by=${actor}`,
    );

    return json({
      ok: true,
      license_id,
      previous_status: existing.status,
      next_status,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[license-status] Fatal:", message);
    return json({ error: message }, 500);
  }
});
