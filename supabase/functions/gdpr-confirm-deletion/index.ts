// GDPR Art. 17 — Right to Erasure (Confirm step).
// Validates confirmation_token, sets status='confirmed' + scheduled_deletion_at (30 days),
// audits to admin_actions. NO immediate hard-delete — handled by separate scheduled job.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Token can come from query (GET link) or POST body
    const url = new URL(req.url);
    let token = url.searchParams.get("token");
    if (!token && req.method !== "GET") {
      try {
        const body = await req.json();
        token = body?.token ?? null;
      } catch {
        /* noop */
      }
    }
    if (!token || typeof token !== "string" || token.length < 16) {
      return json(400, { ok: false, error: "missing_or_invalid_token" });
    }

    // Lookup request
    const { data: rows, error: selErr } = await sb
      .from("gdpr_deletion_requests")
      .select("*")
      .eq("confirmation_token", token)
      .limit(1);

    if (selErr) return json(500, { ok: false, error: "lookup_failed", details: selErr.message });
    const reqRow = (rows ?? [])[0];
    if (!reqRow) return json(404, { ok: false, error: "token_not_found_or_expired" });

    // Idempotent
    if (reqRow.status === "confirmed") {
      return json(200, {
        ok: true,
        already_confirmed: true,
        request_id: reqRow.id,
        scheduled_deletion_at: reqRow.scheduled_deletion_at,
      });
    }
    if (reqRow.status !== "pending") {
      return json(409, {
        ok: false,
        error: "invalid_state",
        current_status: reqRow.status,
      });
    }

    const scheduledDeletionAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: updated, error: updErr } = await sb
      .from("gdpr_deletion_requests")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        scheduled_deletion_at: scheduledDeletionAt,
        confirmation_token: null, // burn the token
        updated_at: new Date().toISOString(),
      })
      .eq("id", reqRow.id)
      .eq("status", "pending") // CAS guard
      .select()
      .single();

    if (updErr) return json(500, { ok: false, error: "update_failed", details: updErr.message });

    // Audit
    await sb.from("admin_actions").insert({
      action_type: "gdpr_deletion_confirmed",
      target_type: "user",
      target_id: reqRow.user_id,
      performed_by: reqRow.user_id,
      payload: {
        request_id: reqRow.id,
        scheduled_deletion_at: scheduledDeletionAt,
        legal_basis: "GDPR Art. 17",
        confirmed_via: "confirmation_token",
      },
    } as any);

    return json(200, {
      ok: true,
      request_id: updated.id,
      status: updated.status,
      scheduled_deletion_at: updated.scheduled_deletion_at,
      grace_period_days: 30,
      message: "Deletion confirmed. Your data will be removed after the 30-day grace period. You can still cancel this request.",
    });
  } catch (e) {
    console.error("[gdpr-confirm-deletion] unexpected:", e);
    return json(500, { ok: false, error: "unexpected_error", details: String((e as any)?.message ?? e) });
  }
});
