import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Council 6: Compliance Report Generator
 * 
 * Generates audit-ready compliance reports (weekly, release, azav, iso29993, ai_act)
 * using the generate_compliance_report() RPC.
 */
Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const payload = body.payload ?? body;

    const validTypes = ["weekly", "release", "azav", "iso29993", "ai_act"];
    const reportType = validTypes.includes(payload.reportType) ? payload.reportType : "weekly";

    console.log(`[ComplianceReport] Generating ${reportType} report`);

    const { data: reportId, error } = await sb.rpc("generate_compliance_report", { p_report_type: reportType });
    if (error) throw error;

    // Fetch the created report for response
    const { data: report } = await sb
      .from("compliance_reports")
      .select("id, report_type, summary_json, created_at")
      .eq("id", reportId)
      .single();

    return new Response(JSON.stringify({ ok: true, reportType, reportId, report }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ComplianceReport] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});
