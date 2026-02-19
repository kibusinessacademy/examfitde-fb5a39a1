import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[FINANCE-REPORTS] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - admin only
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) throw new Error("Not authenticated");

    // Verify admin role
    const { data: roleCheck } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleCheck) throw new Error("Admin access required");

    const url = new URL(req.url);
    const report = url.searchParams.get('report') || 'revenue';
    const from = url.searchParams.get('from') || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
    const format = url.searchParams.get('format') || 'json';

    logStep("Report requested", { report, from, to, format });

    let data: any;

    switch (report) {
      case 'revenue':
        ({ data } = await adminClient.rpc('report_revenue_by_month', { p_from: from, p_to: to }));
        break;
      case 'vat':
        ({ data } = await adminClient.rpc('report_vat_by_rate', { p_from: from, p_to: to }));
        break;
      case 'fees':
        ({ data } = await adminClient.rpc('report_fees_refunds_by_month', { p_from: from, p_to: to }));
        break;
      case 'products':
        ({ data } = await adminClient.rpc('report_revenue_by_product', { p_from: from, p_to: to }));
        break;
      case 'payouts':
        ({ data } = await adminClient.rpc('report_payouts', { p_from: from, p_to: to }));
        break;
      case 'open_items':
        ({ data } = await adminClient.rpc('report_open_items'));
        break;
      case 'audit':
        ({ data } = await adminClient.rpc('report_audit_log', { p_limit: 200 }));
        break;
      case 'ledger_csv':
        ({ data } = await adminClient.rpc('export_ledger_csv', { p_from: from, p_to: to }));
        break;
      default:
        throw new Error(`Unknown report: ${report}`);
    }

    // CSV format
    if (format === 'csv' && Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(';'),
        ...data.map((row: any) =>
          headers.map(h => {
            const val = row[h];
            if (val === null || val === undefined) return '';
            if (typeof val === 'number') return String(val).replace('.', ',');
            return `"${String(val).replace(/"/g, '""')}"`;
          }).join(';')
        ),
      ];
      const csv = csvRows.join('\r\n');

      return new Response(csv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${report}_${from}_${to}.csv"`,
        },
        status: 200,
      });
    }

    // DATEV format (simplified Buchungsstapel)
    if (format === 'datev' && report === 'ledger_csv') {
      const datevRows = [
        'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Konto;Gegenkonto;BU-Schlüssel;Belegdatum;Belegfeld 1;Buchungstext',
        ...(data || []).map((row: any) => {
          const amount = Math.abs(row.betrag_eur || 0).toFixed(2).replace('.', ',');
          const sh = (row.betrag_eur || 0) >= 0 ? 'S' : 'H';
          const konto = row.konto === 'revenue' ? '8400' : row.konto === 'tax_payable' ? '1776' : row.konto === 'stripe_fees' ? '4970' : '1800';
          const gegenkonto = row.gegenkonto === 'receivables' ? '1400' : '8400';
          const datum = (row.buchungsdatum || '').replace(/\./g, '');
          return `${amount};${sh};EUR;${konto};${gegenkonto};;${datum};${row.belegnummer || ''};${row.buchungstext || ''}`;
        }),
      ];
      const datevCsv = datevRows.join('\r\n');

      return new Response(datevCsv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="DATEV_${from}_${to}.csv"`,
        },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ data, report, from, to }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
