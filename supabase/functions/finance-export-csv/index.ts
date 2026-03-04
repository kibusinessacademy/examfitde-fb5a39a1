import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "finance-exports";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const payload = body.payload ?? body;
    const exportId = payload.exportId;

    if (!exportId) return new Response(JSON.stringify({ ok: false, error: "Missing exportId" }), { status: 400, headers });

    const exp = await sb.from("finance_exports").select("id, export_type, period_month, currency, status").eq("id", exportId).single();
    if (exp.error) throw exp.error;

    const exportType = (payload.format ?? exp.data.export_type) as string;
    const month = exp.data.period_month;
    const currency = exp.data.currency ?? "eur";
    if (!month) throw new Error("finance_exports.period_month is required");

    let csv = "";
    let filename = "";

    if (exportType === "monthly_revenue_csv") {
      const rows = await sb.rpc("get_monthly_revenue_lines", { p_month: month, p_currency: currency });
      if (rows.error) throw rows.error;
      csv = toCsv(["occurred_day","gross_cents","net_cents","tax_cents","payments","refunds"],
        (rows.data ?? []).map((r: any) => [r.occurred_day, r.gross_cents, r.net_cents, r.tax_cents, r.payments, r.refunds]));
      filename = `revenue_${month}_${currency}.csv`;
    } else if (exportType === "monthly_vat_csv") {
      const rows = await sb.rpc("get_monthly_vat_lines", { p_month: month, p_currency: currency });
      if (rows.error) throw rows.error;
      csv = toCsv(["tax_country","tax_rate","net_cents","tax_cents","gross_cents","payments"],
        (rows.data ?? []).map((r: any) => [r.tax_country, r.tax_rate, r.net_cents, r.tax_cents, r.gross_cents, r.payments]));
      filename = `vat_${month}_${currency}.csv`;
    } else if (exportType === "b2b_buyer_learner_csv") {
      const rows = await sb.rpc("get_b2b_buyer_learner_summary", { p_month: month, p_currency: currency });
      if (rows.error) throw rows.error;
      csv = toCsv(["buyer_account_id","learner_user_id","payments","gross_cents","net_cents","tax_cents"],
        (rows.data ?? []).map((r: any) => [r.buyer_account_id, r.learner_user_id, r.payments, r.gross_cents, r.net_cents, r.tax_cents]));
      filename = `b2b_buyer_learner_${month}_${currency}.csv`;
    } else {
      throw new Error(`Unsupported export type: ${exportType}`);
    }

    const path = `exports/${exportType}/${month}/${filename}`;
    const upload = await sb.storage.from(BUCKET).upload(path, new TextEncoder().encode(csv), { contentType: "text/csv; charset=utf-8", upsert: true });
    if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

    await sb.from("finance_exports").update({ status: "generated", file_path: path, generated_at: new Date().toISOString(), meta: { exportType, month, currency } }).eq("id", exp.data.id);

    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signed.error) throw signed.error;

    return new Response(JSON.stringify({ ok: true, exportId: exp.data.id, file_path: path, signed_url: signed.data.signedUrl }), { status: 200, headers });
  } catch (err: any) {
    console.error("[finance-export-csv] error:", err?.message ?? err);
    return new Response(JSON.stringify({ ok: false, error: err?.message ?? String(err) }), { status: 500, headers });
  }
});

function toCsv(headers: string[], rows: any[][]) {
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers.map(esc).join(";"), ...rows.map(r => r.map(esc).join(";"))].join("\n");
}
