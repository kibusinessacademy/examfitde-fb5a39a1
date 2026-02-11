import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

    if (!payload.month) return new Response(JSON.stringify({ ok: false, error: "Missing month (YYYY-MM-DD)" }), { status: 400, headers });

    const currency = (payload.currency ?? "eur").toLowerCase();
    const configName = payload.configName ?? "default";
    const month = payload.month;

    const rows = await sb.rpc("get_datev_prep_lines", { p_month: month, p_currency: currency, p_config_name: configName });
    if (rows.error) throw rows.error;

    const csv = toCsv(
      ["Belegdatum","Belegfeld1","Buchungstext","Konto","Gegenkonto","Steuerschluessel","Betrag","Waehrung","OrderId","PaymentIntent"],
      (rows.data ?? []).map((r: any) => [r.belegdatum, r.belegfeld1, r.buchungstext, r.konto, r.gegenkonto, r.steuer_schluessel, r.betrag, r.waehrung, r.order_id, r.payment_intent])
    );

    const filename = `datev_prep_${month}_${currency}_${configName}.csv`;
    const path = `exports/datev_prep/${month}/${filename}`;

    const upload = await sb.storage.from(BUCKET).upload(path, new TextEncoder().encode(csv), { contentType: "text/csv; charset=utf-8", upsert: true });
    if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signed.error) throw signed.error;

    return new Response(JSON.stringify({ ok: true, path, signed_url: signed.data.signedUrl, rows: (rows.data ?? []).length }), { status: 200, headers });
  } catch (err: any) {
    console.error("[finance-export-datev] error:", err?.message ?? err);
    return new Response(JSON.stringify({ ok: false, error: err?.message ?? String(err) }), { status: 500, headers });
  }
});

function toCsv(headers: string[], rows: any[][]) {
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers.map(esc).join(";"), ...rows.map(r => r.map(esc).join(";"))].join("\n");
}
