import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "compliance-reports";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    // Auth check
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Verify user is admin
    const { data: { user }, error: authErr } = await createClient(
      SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!
    ).auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), { status: 403, headers });
    }

    const body = await req.json().catch(() => ({}));
    const docId = body.docId as string | undefined;
    if (!docId) {
      return new Response(JSON.stringify({ error: "Missing docId" }), { status: 400, headers });
    }

    // Load document
    const { data: doc, error: docErr } = await sb
      .from("compliance_documents")
      .select("*")
      .eq("id", docId)
      .single();
    if (docErr) throw docErr;

    // Generate PDF from markdown content
    const pdfBytes = await renderCompliancePDF({
      title: doc.title,
      docType: doc.doc_type,
      version: doc.version,
      createdAt: doc.created_at,
      contentMd: doc.content_md,
    });

    const path = `docs/${doc.doc_type}/v${doc.version}_${doc.id}.pdf`;

    // Upload
    const { error: uploadErr } = await sb.storage.from(BUCKET).upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    // Update document record
    await sb.from("compliance_documents")
      .update({ pdf_path: path })
      .eq("id", doc.id);

    // Signed URL (1 hour)
    const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signErr) throw signErr;

    // Audit
    await sb.from("admin_actions").insert({
      user_id: user.id,
      action: "compliance_pdf_generated",
      scope: "compliance",
      payload: { doc_id: doc.id, doc_type: doc.doc_type, version: doc.version },
    });

    return new Response(JSON.stringify({
      ok: true,
      docId: doc.id,
      pdf_path: path,
      signed_url: signed.signedUrl,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ComplianceDocPDF] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function renderCompliancePDF(input: {
  title: string;
  docType: string;
  version: number;
  createdAt: string;
  contentMd: string;
}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 50;
  const CONTENT_W = PAGE_W - 2 * MARGIN;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const addPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const drawText = (text: string, opts: { bold?: boolean; size?: number; color?: [number, number, number]; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.bold ? bold : font;
    const x = MARGIN + (opts.indent ?? 0);
    const maxChars = Math.floor(CONTENT_W / (size * 0.5));

    // Word-wrap
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > maxChars && line) {
        if (y < 60) addPage();
        page.drawText(line, {
          x, y, size, font: f,
          color: opts.color ? rgb(opts.color[0], opts.color[1], opts.color[2]) : undefined,
        });
        y -= size + 4;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      if (y < 60) addPage();
      page.drawText(line, {
        x, y, size, font: f,
        color: opts.color ? rgb(opts.color[0], opts.color[1], opts.color[2]) : undefined,
      });
      y -= size + 4;
    }
  };

  // Header
  drawText("ExamFit – Compliance-Dokument", { bold: true, size: 16 });
  y -= 4;

  // Separator line
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 12;

  drawText(`Typ: ${input.docType.replace(/_/g, ' ').toUpperCase()}`, { size: 10 });
  drawText(`Titel: ${input.title}`, { bold: true, size: 11 });
  drawText(`Version: ${input.version}`, { size: 9 });
  drawText(`Erstellt: ${new Date(input.createdAt).toLocaleDateString('de-DE')}`, { size: 9 });
  drawText(`PDF generiert: ${new Date().toLocaleDateString('de-DE')}`, { size: 9 });
  y -= 8;

  // Parse markdown into lines and render
  const lines = input.contentMd.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line) {
      y -= 6;
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      y -= 8;
      drawText(line.slice(2), { bold: true, size: 14 });
      y -= 2;
    } else if (line.startsWith('## ')) {
      y -= 6;
      drawText(line.slice(3), { bold: true, size: 12 });
      y -= 1;
    } else if (line.startsWith('### ')) {
      y -= 4;
      drawText(line.slice(4), { bold: true, size: 11 });
    } else if (line.startsWith('- ')) {
      drawText(`  •  ${line.slice(2).replace(/\*\*/g, '')}`, { size: 9, indent: 10 });
    } else if (line.startsWith('| ')) {
      // Table row - simplified rendering
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      if (cells.some(c => /^-+$/.test(c))) continue; // skip separator
      const cellText = cells.join('   |   ');
      drawText(cellText, { size: 8 });
    } else if (line.startsWith('_') && line.endsWith('_')) {
      drawText(line.replace(/_/g, ''), { size: 8, color: [0.5, 0.5, 0.5] });
    } else {
      drawText(line.replace(/\*\*/g, '').replace(/`/g, ''), { size: 9 });
    }
  }

  // Footer on every page
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.drawText(`ExamFit Compliance – ${input.title} (v${input.version}) – Seite ${i + 1}/${pages.length}`, {
      x: MARGIN, y: 25, size: 7, font, color: rgb(0.5, 0.5, 0.5),
    });
  }

  return await doc.save();
}
