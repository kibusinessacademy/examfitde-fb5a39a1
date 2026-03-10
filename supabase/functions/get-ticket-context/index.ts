// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" });

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" });

    const url = new URL(req.url);
    const ticketType = url.searchParams.get("ticket_type");

    // 1) Profile + Company
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, company_id, personnel_number")
      .eq("user_id", userId)
      .maybeSingle();

    let company = null;
    if (profile?.company_id) {
      const { data: c } = await supabase
        .from("companies")
        .select("id, name")
        .eq("id", profile.company_id)
        .maybeSingle();
      company = c;
    }

    // 2) Orders (as buyer) - last 20
    const { data: orders } = await supabase
      .from("orders")
      .select("id, created_at, status, total_cents, currency, billing_name, billing_company, billing_email")
      .eq("buyer_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    // 3) Invoices for those orders
    const orderIds = (orders ?? []).map((o: any) => o.id);
    let invoices: any[] = [];
    if (orderIds.length > 0) {
      const { data: inv } = await supabase
        .from("invoices")
        .select("id, order_id, invoice_number, issue_date, status, total_gross_cents")
        .in("order_id", orderIds)
        .order("issue_date", { ascending: false })
        .limit(20);
      invoices = inv ?? [];
    }

    // 4) Payments for those orders
    let payments: any[] = [];
    if (orderIds.length > 0) {
      const { data: pay } = await supabase
        .from("payments")
        .select("id, order_id, amount_cents, currency, payment_status, paid_at")
        .in("order_id", orderIds)
        .order("paid_at", { ascending: false })
        .limit(20);
      payments = pay ?? [];
    }

    // 5) Learners managed by this user (B2B: company members)
    let managedLearners: any[] = [];
    if (profile?.company_id) {
      const { data: learners } = await supabase
        .from("profiles")
        .select("user_id, full_name, login_username, personnel_number, managed_account")
        .eq("company_id", profile.company_id)
        .neq("user_id", userId)
        .order("full_name")
        .limit(50);
      managedLearners = learners ?? [];
    }

    // 6) Certifications (from enrollments)
    const { data: enrollments } = await supabase
      .from("course_enrollments")
      .select("course_id, courses(id, title, certification_id)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    // 7) Ticket templates (suggested sub-categories per type)
    const templates: Record<string, { id: string; label: string; default_priority: string }[]> = {
      BILLING_QUESTION: [
        { id: "invoice_missing", label: "Rechnung fehlt", default_priority: "MEDIUM" },
        { id: "address_change", label: "Rechnungsadresse ändern", default_priority: "LOW" },
        { id: "vat_reverse_charge", label: "USt-IdNr / Reverse Charge", default_priority: "MEDIUM" },
        { id: "payment_assignment", label: "Zahlung nicht zugeordnet", default_priority: "HIGH" },
        { id: "credit_note", label: "Storno / Gutschrift", default_priority: "HIGH" },
      ],
      LICENSE_QUESTION: [
        { id: "seat_missing", label: "Lizenz/Seat fehlt", default_priority: "HIGH" },
        { id: "upgrade", label: "Upgrade / Verlängerung", default_priority: "MEDIUM" },
        { id: "transfer", label: "Lizenz umschreiben", default_priority: "MEDIUM" },
        { id: "duration", label: "Laufzeit-Frage", default_priority: "LOW" },
      ],
      LEARNER_ACCOUNT_ISSUE: [
        { id: "login_problem", label: "Learner kann sich nicht einloggen", default_priority: "HIGH" },
        { id: "wrong_assignment", label: "Falsch zugeordnet", default_priority: "MEDIUM" },
        { id: "seat_inactive", label: "Seat/Lizenz nicht aktiv", default_priority: "HIGH" },
        { id: "deactivate", label: "Account deaktivieren", default_priority: "LOW" },
      ],
      DATA_CORRECTION: [
        { id: "company_data", label: "Firmendaten korrigieren", default_priority: "MEDIUM" },
        { id: "billing_address", label: "Rechnungsadresse", default_priority: "MEDIUM" },
        { id: "vat_id", label: "USt-IdNr ändern", default_priority: "MEDIUM" },
        { id: "name_change", label: "Namensänderung", default_priority: "LOW" },
      ],
      TECHNICAL_ISSUE: [
        { id: "bug_report", label: "Fehler / Bug melden", default_priority: "HIGH" },
        { id: "performance", label: "Performance-Problem", default_priority: "MEDIUM" },
        { id: "display_issue", label: "Darstellungsfehler", default_priority: "LOW" },
      ],
      CONTENT_ISSUE: [
        { id: "wrong_answer", label: "Falsche Antwort", default_priority: "HIGH" },
        { id: "unclear_content", label: "Unklare Erklärung", default_priority: "MEDIUM" },
        { id: "outdated", label: "Veralteter Inhalt", default_priority: "MEDIUM" },
        { id: "typo", label: "Tippfehler", default_priority: "LOW" },
      ],
      FEATURE_REQUEST: [
        { id: "new_feature", label: "Neue Funktion", default_priority: "LOW" },
        { id: "improvement", label: "Verbesserung", default_priority: "LOW" },
        { id: "integration", label: "Integration gewünscht", default_priority: "LOW" },
      ],
    };

    return json(200, {
      profile: profile ? { full_name: profile.full_name, company_id: profile.company_id, personnel_number: profile.personnel_number } : null,
      company,
      orders: (orders ?? []).map((o: any) => ({
        id: o.id,
        created_at: o.created_at,
        status: o.status,
        total_cents: o.total_cents,
        currency: o.currency,
        billing_name: o.billing_name,
        billing_company: o.billing_company,
      })),
      invoices: invoices.map((i: any) => ({
        id: i.id,
        order_id: i.order_id,
        invoice_number: i.invoice_number,
        issue_date: i.issue_date,
        status: i.status,
        total_gross_cents: i.total_gross_cents,
      })),
      payments: payments.map((p: any) => ({
        id: p.id,
        order_id: p.order_id,
        amount_cents: p.amount_cents,
        currency: p.currency,
        payment_status: p.payment_status,
        paid_at: p.paid_at,
      })),
      managed_learners: managedLearners.map((l: any) => ({
        user_id: l.user_id,
        full_name: l.full_name,
        login_username: l.login_username,
        personnel_number: l.personnel_number,
      })),
      certifications: (enrollments ?? []).map((e: any) => ({
        course_id: e.course_id,
        title: e.courses?.title,
        certification_id: e.courses?.certification_id,
      })),
      templates: ticketType ? (templates[ticketType] ?? []) : templates,
    });
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as Error)?.message ?? e) });
  }
});
