import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "compliance-reports";

/**
 * Council 6: Compliance Report PDF Export
 * 
 * Generates an A4 PDF from a compliance_report record,
 * uploads to Storage, and returns a signed URL.
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
    const reportId = payload.reportId as string | undefined;

    if (!reportId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing reportId" }), { status: 400, headers });
    }

    // Load report
    const { data: report, error: rErr } = await sb
      .from("compliance_reports")
      .select("id, report_type, summary_json, created_at")
      .eq("id", reportId)
      .single();
    if (rErr) throw rErr;

    // Load top open findings for the PDF body
    const { data: findings, error: fErr } = await sb
      .from("compliance_findings")
      .select("id, area, severity, title, status, updated_at, patch_plan_id")
      .eq("status", "open")
      .order("severity", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (fErr) throw fErr;

    // Create PDF
    const pdfBytes = await renderCompliancePDF({
      reportType: report.report_type,
      createdAt: report.created_at,
      summary: report.summary_json as Record<string, unknown>,
      findings: findings ?? [],
    });

    const path = `reports/${report.report_type}/${report.id}.pdf`;

    // Upload to storage
    const { error: uploadErr } = await sb.storage.from(BUCKET).upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}. Ensure bucket "${BUCKET}" exists.`);
    }

    // Store pointer in DB
    await sb.from("compliance_reports")
      .update({ pdf_path: path, pdf_generated_at: new Date().toISOString() })
      .eq("id", report.id);

    // Signed URL (1 hour)
    const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signErr) throw signErr;

    console.log(`[ComplianceExportPDF] Generated PDF for report ${report.id} → ${path}`);

    return new Response(JSON.stringify({
      ok: true,
      reportId: report.id,
      pdf_path: path,
      signed_url: signed.signedUrl,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ComplianceExportPDF] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function renderCompliancePDF(input: {
  reportType: string;
  createdAt: string;
  summary: Record<string, unknown>;
  findings: Array<Record<string, unknown>>;
}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([595.28, 841.89]); // A4
  let y = page.getSize().height - 50;

  const draw = (text: string, isBold = false, size = 11) => {
    if (y < 60) {
      page = doc.addPage([595.28, 841.89]);
      y = page.getSize().height - 50;
    }
    page.drawText(text, { x: 50, y, size, font: isBold ? bold : font });
    y -= size + 6;
  };

  draw("ExamFit – Compliance Report", true, 18);
  y -= 4;
  draw(`Report Type: ${input.reportType.toUpperCase()}`, false, 12);
  draw(`Created: ${new Date(input.createdAt).toLocaleString("de-DE")}`, false, 12);
  draw(`Generated: ${new Date().toLocaleString("de-DE")}`, false, 10);

  y -= 12;
  draw("Summary", true, 14);

  const openCounts = (input.summary?.open_counts ?? {}) as Record<string, number>;
  for (const [sev, cnt] of Object.entries(openCounts)) {
    draw(`  ${sev}: ${cnt} open`, false, 10);
  }

  const openByArea = (input.summary?.open_by_area ?? {}) as Record<string, number>;
  if (Object.keys(openByArea).length > 0) {
    y -= 6;
    draw("Open by Area", true, 12);
    for (const [area, cnt] of Object.entries(openByArea)) {
      draw(`  ${area}: ${cnt}`, false, 10);
    }
  }

  const criticalItems = (input.summary?.critical_items ?? []) as Array<Record<string, unknown>>;
  if (criticalItems.length > 0) {
    y -= 6;
    draw("Critical Items", true, 12);
    for (const item of criticalItems.slice(0, 10)) {
      draw(`  [${item.severity}] (${item.area}) ${truncate(String(item.title ?? ""), 70)}`, false, 9);
    }
  }

  y -= 12;
  draw(`All Open Findings (${input.findings.length})`, true, 14);

  for (const f of input.findings) {
    const line = `[${f.severity}] (${f.area}) ${truncate(String(f.title ?? ""), 75)}  | patch=${f.patch_plan_id ? "yes" : "-"}`;
    draw(line, false, 9);
  }

  // Footer on last page
  page.drawText("Generated by Council 6 (Compliance & Data Protection) – ExamFit", {
    x: 50, y: 30, size: 8, font,
  });

  return await doc.save();
}

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
