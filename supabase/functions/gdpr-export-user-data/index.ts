// GDPR Art. 15 — Right of Access. Exports all personal data for the authenticated user (or admin-targeted user) as JSON.
// No new tables. Reads existing tables only. Audited via admin_actions.
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

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return json(401, { error: "missing_bearer" });

    const { data: u } = await sb.auth.getUser(token);
    const callerId = u?.user?.id;
    const callerEmail = u?.user?.email ?? null;
    if (!callerId) return json(401, { error: "invalid_token" });

    // Optional admin-targeted export
    let targetUserId = callerId;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.target_user_id && body.target_user_id !== callerId) {
          const { data: isAdmin } = await sb.rpc("has_role", {
            _user_id: callerId,
            _role: "admin",
          });
          if (!isAdmin) return json(403, { error: "admin_only_for_target_user_id" });
          targetUserId = body.target_user_id;
        }
      } catch {
        // empty body is fine — self-export
      }
    }

    // Helper: silent fetch (table may have no rows; never abort the entire export)
    const fetchTable = async (
      table: string,
      column: string,
      select = "*",
    ): Promise<unknown[]> => {
      try {
        const { data, error } = await sb.from(table as any).select(select).eq(column, targetUserId);
        if (error) {
          console.warn(`[gdpr-export] ${table} error:`, error.message);
          return [];
        }
        return data ?? [];
      } catch (e) {
        console.warn(`[gdpr-export] ${table} threw:`, (e as Error).message);
        return [];
      }
    };

    // Profile
    const profile = (await fetchTable("profiles", "id"))[0] ?? (await fetchTable("profiles", "user_id"))[0] ?? null;

    // Orders + invoices (orders.user_id; invoices via order_id)
    const orders = await fetchTable("orders", "user_id");
    const orderIds = (orders as any[]).map((o) => o.id).filter(Boolean);

    let invoices: unknown[] = [];
    let invoice_items: unknown[] = [];
    if (orderIds.length > 0) {
      const { data: inv } = await sb.from("invoices" as any).select("*").in("order_id", orderIds);
      invoices = inv ?? [];
      const invIds = (invoices as any[]).map((i) => i.id).filter(Boolean);
      if (invIds.length > 0) {
        const { data: items } = await sb.from("invoice_items" as any).select("*").in("invoice_id", invIds);
        invoice_items = items ?? [];
      }
    }

    const entitlements = await fetchTable("entitlements", "user_id");
    const learner_course_grants = await fetchTable("learner_course_grants", "user_id");
    const quiz_attempts = await fetchTable("quiz_attempts", "user_id");
    const conversion_events = await fetchTable("conversion_events", "user_id");

    // Licenses (owner)
    const license_packages_owned = await fetchTable("license_packages", "owner_user_id");
    // License seats assigned to this user
    const license_seats_assigned = await fetchTable("license_seats", "assigned_user_id");

    const support_tickets = await fetchTable("support_tickets", "user_id");
    const gdpr_requests = await fetchTable("gdpr_deletion_requests", "user_id");

    const exportPayload = {
      meta: {
        export_version: "1.0",
        generated_at: new Date().toISOString(),
        target_user_id: targetUserId,
        target_email: targetUserId === callerId ? callerEmail : null,
        legal_basis: "GDPR Art. 15 — Right of Access",
        export_scope: "all_personal_data",
      },
      auth_user: targetUserId === callerId ? { id: callerId, email: callerEmail } : { id: targetUserId },
      profile,
      orders,
      invoices,
      invoice_items,
      entitlements,
      learner_course_grants,
      quiz_attempts,
      conversion_events,
      license_packages_owned,
      license_seats_assigned,
      support_tickets,
      gdpr_requests,
    };

    // Audit
    await sb.from("admin_actions").insert({
      action_type: "gdpr_export_user_data",
      target_type: "user",
      target_id: targetUserId,
      performed_by: callerId,
      payload: {
        self_export: targetUserId === callerId,
        counts: {
          orders: (orders as any[]).length,
          invoices: (invoices as any[]).length,
          invoice_items: (invoice_items as any[]).length,
          entitlements: (entitlements as any[]).length,
          grants: (learner_course_grants as any[]).length,
          quiz_attempts: (quiz_attempts as any[]).length,
          conversion_events: (conversion_events as any[]).length,
          license_packages_owned: (license_packages_owned as any[]).length,
          license_seats_assigned: (license_seats_assigned as any[]).length,
          support_tickets: (support_tickets as any[]).length,
          gdpr_requests: (gdpr_requests as any[]).length,
        },
      },
    } as any);

    return new Response(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="gdpr-export-${targetUserId}-${Date.now()}.json"`,
      },
    });
  } catch (e) {
    console.error("[gdpr-export-user-data] unexpected:", e);
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) });
  }
});
