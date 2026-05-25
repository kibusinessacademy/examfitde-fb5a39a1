// BerufOS Waitlist Signup — accepts anonymous email signups for planned modules.
// Routes inserts to email_delivery_queue (service-role only) + audit trail.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_SLUGS = new Set([
  "learning", "workforce", "agents", "documents", "workflows",
  "skills", "career", "recruit", "industry", "governance",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const slug = String(body.module_slug ?? "").trim().toLowerCase();

    if (!email || !email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      return new Response(JSON.stringify({ error: "invalid_email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!VALID_SLUGS.has(slug)) {
      return new Response(JSON.stringify({ error: "invalid_module_slug" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const idemKey = `berufos_waitlist|${email}|${slug}`;
    const { error: insertErr } = await sb.from("email_delivery_queue").insert({
      recipient_email: email,
      sequence_type: `berufos_waitlist_${slug}`,
      step_number: 1,
      scheduled_for: new Date().toISOString(),
      status: "pending",
      idempotency_key: idemKey,
      personalization: { module_slug: slug, source: "berufos_landing" },
      audience: "berufos_waitlist",
    });

    // Idempotent: duplicate is success.
    if (insertErr && !String(insertErr.message).toLowerCase().includes("duplicate")) {
      console.error("[berufos-waitlist] insert failed:", insertErr);
      return new Response(JSON.stringify({ error: "insert_failed", detail: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Best-effort audit (do not block on failure)
    try {
      await sb.rpc("fn_emit_audit", {
        _action_type: "berufos_waitlist_signup",
        _target_type: "system",
        _target_id: null,
        _result_status: "ok",
        _metadata: { module_slug: slug, email_hash: await hashEmail(email) },
      });
    } catch (auditErr) {
      console.warn("[berufos-waitlist] audit emit failed (non-blocking):", auditErr);
    }

    return new Response(JSON.stringify({ ok: true, idempotency_key: idemKey }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[berufos-waitlist] unhandled:", err);
    return new Response(JSON.stringify({ error: "unhandled", detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function hashEmail(email: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
