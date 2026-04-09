import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate admin
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: adminRole } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    switch (action) {
      case "list_partners": {
        const { data, error } = await admin
          .from("partner_accounts")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonResponse({ ok: true, data }, corsHeaders);
      }

      case "update_partner_status": {
        const body = await req.json();
        const { partner_id, status } = body;
        const { error } = await admin
          .from("partner_accounts")
          .update({ status })
          .eq("id", partner_id);
        if (error) throw error;

        await admin.from("partner_audit_events").insert({
          partner_id, actor_user_id: user.id,
          event_type: "partner_status_changed", entity_type: "partner_accounts",
          entity_id: partner_id, metadata_json: { new_status: status },
        });

        return jsonResponse({ ok: true }, corsHeaders);
      }

      case "approve_commission": {
        const body = await req.json();
        const { commission_id } = body;
        const { error } = await admin
          .from("partner_commissions")
          .update({ commission_status: "approved", approved_at: new Date().toISOString() })
          .eq("id", commission_id)
          .eq("commission_status", "pending");
        if (error) throw error;

        await admin.from("partner_audit_events").insert({
          actor_user_id: user.id, event_type: "commission_approved",
          entity_type: "partner_commissions", entity_id: commission_id,
        });

        return jsonResponse({ ok: true }, corsHeaders);
      }

      case "reject_commission": {
        const body = await req.json();
        const { commission_id, reason } = body;
        const { error } = await admin
          .from("partner_commissions")
          .update({ commission_status: "rejected", commission_reason: reason })
          .eq("id", commission_id)
          .eq("commission_status", "pending");
        if (error) throw error;
        return jsonResponse({ ok: true }, corsHeaders);
      }

      case "approve_payout": {
        const body = await req.json();
        const { payout_id, approved_amount } = body;
        const { error } = await admin
          .from("partner_payout_requests")
          .update({
            payout_status: "approved",
            approved_amount_eur: approved_amount,
            approved_at: new Date().toISOString(),
          })
          .eq("id", payout_id)
          .eq("payout_status", "requested");
        if (error) throw error;

        await admin.from("partner_audit_events").insert({
          actor_user_id: user.id, event_type: "payout_approved",
          entity_type: "partner_payout_requests", entity_id: payout_id,
          metadata_json: { approved_amount },
        });

        return jsonResponse({ ok: true }, corsHeaders);
      }

      case "mark_payout_paid": {
        const body = await req.json();
        const { payout_id, reference } = body;

        // Get payout to find partner and approved commissions
        const { data: payout } = await admin
          .from("partner_payout_requests")
          .select("*")
          .eq("id", payout_id)
          .eq("payout_status", "approved")
          .single();

        if (!payout) {
          return jsonResponse({ ok: false, error: "Payout not found or not approved" }, corsHeaders, 400);
        }

        // Mark payout as paid
        await admin
          .from("partner_payout_requests")
          .update({
            payout_status: "paid",
            payout_reference: reference,
            paid_at: new Date().toISOString(),
          })
          .eq("id", payout_id);

        // Mark approved commissions as paid
        await admin
          .from("partner_commissions")
          .update({ commission_status: "paid", paid_at: new Date().toISOString() })
          .eq("partner_id", payout.partner_id)
          .eq("commission_status", "approved");

        await admin.from("partner_audit_events").insert({
          partner_id: payout.partner_id, actor_user_id: user.id,
          event_type: "payout_paid", entity_type: "partner_payout_requests",
          entity_id: payout_id, metadata_json: { reference, amount: payout.approved_amount_eur },
        });

        return jsonResponse({ ok: true }, corsHeaders);
      }

      case "list_commissions": {
        const { data, error } = await admin
          .from("partner_commissions")
          .select("*, partner_accounts(referral_code, contact_name, company_name)")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return jsonResponse({ ok: true, data }, corsHeaders);
      }

      case "list_payouts": {
        const { data, error } = await admin
          .from("partner_payout_requests")
          .select("*, partner_accounts(referral_code, contact_name, company_name)")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return jsonResponse({ ok: true, data }, corsHeaders);
      }

      case "list_audit": {
        const { data, error } = await admin
          .from("partner_audit_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return jsonResponse({ ok: true, data }, corsHeaders);
      }

      case "list_commission_rules": {
        const { data, error } = await admin
          .from("partner_commission_rules")
          .select("*")
          .order("partner_type", { ascending: true });
        if (error) throw error;
        return jsonResponse({ ok: true, data }, corsHeaders);
      }

      case "upsert_commission_rule": {
        const body = await req.json();
        const { id, ...ruleData } = body;
        if (id) {
          await admin.from("partner_commission_rules").update(ruleData).eq("id", id);
        } else {
          await admin.from("partner_commission_rules").insert(ruleData);
        }
        return jsonResponse({ ok: true }, corsHeaders);
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, corsHeaders, 400);
    }
  } catch (e) {
    console.error("[admin-partner-api] Error:", e);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function jsonResponse(data: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
