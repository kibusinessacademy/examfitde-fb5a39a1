/**
 * Berufs-KI Dokumenten-Agent — Phase 2 Export Engine.
 * Generiert PDF (pdf-lib) und DOCX (docx) mit Branding-Profil aus einem
 * vorhandenen document_agent_run, lädt nach `document-exports/<uid>/...` hoch
 * und protokolliert in document_agent_exports (export_hash = sha256).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, BorderStyle, PageBreak,
} from "https://esm.sh/docx@8.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExportRequest {
  run_id: string;
  format: "pdf" | "docx";
}

// ─────── Helpers ───────
function hexToRgb(hex?: string | null): { r: number; g: number; b: number } {
  if (!hex) return { r: 0.12, g: 0.27, b: 0.42 };
  const h = hex.replace("#", "");
  if (h.length !== 6) return { r: 0.12, g: 0.27, b: 0.42 };
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function splitSections(body: string): Array<{ title: string; lines: string[] }> {
  // Sections by markdown-style "## " or "# " or "**Heading**"
  const lines = body.split(/\r?\n/);
  const sections: Array<{ title: string; lines: string[] }> = [];
  let cur: { title: string; lines: string[] } = { title: "", lines: [] };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = /^#{1,3}\s+(.*)$/.exec(line) ?? /^\*\*(.+)\*\*\s*:?\s*$/.exec(line);
    if (m) {
      if (cur.title || cur.lines.length) sections.push(cur);
      cur = { title: m[1].trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.title || cur.lines.length) sections.push(cur);
  return sections.length ? sections : [{ title: "", lines: body.split(/\r?\n/) }];
}

// ─────── PDF Renderer ───────
async function renderPdf(opts: {
  title: string; body: string; profile: Record<string, unknown> | null;
  reviewRequired: boolean; complianceWarnings: Array<{ code: string; message: string }>;
}): Promise<Uint8Array> {
  const p = (opts.profile ?? {}) as Record<string, string | null | undefined>;
  const primary = hexToRgb((p.brand_colors as unknown as Record<string, string> | null)?.primary ?? "#1E40AF");
  const muted = rgb(0.45, 0.45, 0.5);
  const text = rgb(0.1, 0.1, 0.12);

  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title);
  pdf.setProducer("ExamFit@work · Berufs-KI Dokumenten-Agent");
  pdf.setCreator("ExamFit@work");
  pdf.setCreationDate(new Date());

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const A4 = { w: 595.28, h: 841.89 };
  const margin = { top: 90, bottom: 90, left: 60, right: 60 };
  const contentW = A4.w - margin.left - margin.right;

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - margin.top;

  const drawHeader = (pg: typeof page) => {
    const company = (p.company_name as string) ?? "";
    if (company) {
      pg.drawText(company, {
        x: margin.left, y: A4.h - 40, size: 11, font: fontBold,
        color: rgb(primary.r, primary.g, primary.b),
      });
    }
    if (p.website) {
      pg.drawText(String(p.website), {
        x: A4.w - margin.right - font.widthOfTextAtSize(String(p.website), 9),
        y: A4.h - 40, size: 9, font, color: muted,
      });
    }
    pg.drawLine({
      start: { x: margin.left, y: A4.h - 55 },
      end: { x: A4.w - margin.right, y: A4.h - 55 },
      thickness: 1.5, color: rgb(primary.r, primary.g, primary.b),
    });
  };

  const drawFooter = (pg: typeof page, pageNo: number, totalPages: number) => {
    pg.drawLine({
      start: { x: margin.left, y: 60 },
      end: { x: A4.w - margin.right, y: 60 },
      thickness: 0.5, color: muted,
    });
    const parts: string[] = [];
    if (p.company_name) parts.push(String(p.company_name));
    if (p.contact_email) parts.push(String(p.contact_email));
    if (p.phone) parts.push(String(p.phone));
    if (p.vat_id) parts.push(`USt-ID: ${p.vat_id}`);
    const line = parts.join("  ·  ");
    if (line) {
      pg.drawText(line, {
        x: margin.left, y: 45, size: 8, font, color: muted,
      });
    }
    const pageLbl = `Seite ${pageNo} / ${totalPages}`;
    pg.drawText(pageLbl, {
      x: A4.w - margin.right - font.widthOfTextAtSize(pageLbl, 8),
      y: 45, size: 8, font, color: muted,
    });
  };

  // word-wrap utility
  const wrap = (str: string, size: number, f = font): string[] => {
    const words = str.split(/\s+/);
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > contentW) {
        if (cur) out.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) out.push(cur);
    return out;
  };

  const ensureSpace = (h: number) => {
    if (y - h < margin.bottom + 20) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - margin.top;
    }
  };

  drawHeader(page);

  // Title
  const titleLines = wrap(opts.title, 20, fontBold);
  for (const tl of titleLines) {
    ensureSpace(28);
    page.drawText(tl, { x: margin.left, y, size: 20, font: fontBold, color: text });
    y -= 26;
  }
  y -= 6;

  // Review banner
  if (opts.reviewRequired) {
    ensureSpace(32);
    page.drawRectangle({
      x: margin.left, y: y - 22, width: contentW, height: 26,
      color: rgb(0.99, 0.93, 0.83),
    });
    page.drawText("ENTWURF — fachliche / juristische Prüfung empfohlen.", {
      x: margin.left + 10, y: y - 14, size: 10, font: fontBold,
      color: rgb(0.55, 0.35, 0.05),
    });
    y -= 36;
  }

  // Body
  const sections = splitSections(opts.body);
  for (const s of sections) {
    if (s.title) {
      ensureSpace(24);
      page.drawText(s.title, {
        x: margin.left, y, size: 13, font: fontBold,
        color: rgb(primary.r, primary.g, primary.b),
      });
      y -= 18;
    }
    for (const ln of s.lines) {
      if (!ln.trim()) { y -= 6; continue; }
      const cleaned = ln.replace(/^\s*[-*]\s+/, "• ");
      for (const wrapped of wrap(cleaned, 11)) {
        ensureSpace(16);
        page.drawText(wrapped, { x: margin.left, y, size: 11, font, color: text });
        y -= 15;
      }
    }
    y -= 8;
  }

  // Signature block
  if (p.default_signature || p.default_sender_name) {
    y -= 10;
    ensureSpace(60);
    page.drawText("Mit freundlichen Grüßen", { x: margin.left, y, size: 11, font, color: text });
    y -= 30;
    if (p.default_sender_name) {
      page.drawText(String(p.default_sender_name), { x: margin.left, y, size: 11, font: fontBold, color: text });
      y -= 14;
    }
    if (p.default_sender_role) {
      page.drawText(String(p.default_sender_role), { x: margin.left, y, size: 10, font, color: muted });
      y -= 14;
    }
    if (p.default_signature) {
      for (const ln of wrap(String(p.default_signature), 10)) {
        ensureSpace(14);
        page.drawText(ln, { x: margin.left, y, size: 10, font, color: muted });
        y -= 12;
      }
    }
  }

  // Disclaimer
  if (p.disclaimer_text || opts.complianceWarnings.length) {
    y -= 12;
    ensureSpace(40);
    page.drawText("Hinweis", { x: margin.left, y, size: 9, font: fontBold, color: muted });
    y -= 12;
    const disclaimer = (p.disclaimer_text as string) ??
      "Dieses Dokument wurde KI-unterstützt erstellt und ist reviewfähig. Keine Garantie auf rechtliche Verbindlichkeit.";
    for (const ln of wrap(disclaimer, 9)) {
      ensureSpace(12);
      page.drawText(ln, { x: margin.left, y, size: 9, font, color: muted });
      y -= 11;
    }
  }

  // Draw header/footer on every page
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    if (i > 0) drawHeader(pg);
    drawFooter(pg, i + 1, pages.length);
  });

  return await pdf.save();
}

// ─────── DOCX Renderer ───────
async function renderDocx(opts: {
  title: string; body: string; profile: Record<string, unknown> | null;
  reviewRequired: boolean;
}): Promise<Uint8Array> {
  const p = (opts.profile ?? {}) as Record<string, string | null | undefined>;
  const sections = splitSections(opts.body);

  const headerChildren = [
    new Paragraph({
      children: [
        new TextRun({
          text: (p.company_name as string) ?? "",
          bold: true, size: 22, color: "1E40AF",
        }),
      ],
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1E40AF", space: 4 } },
    }),
  ];

  const footerParts: string[] = [];
  if (p.company_name) footerParts.push(String(p.company_name));
  if (p.contact_email) footerParts.push(String(p.contact_email));
  if (p.phone) footerParts.push(String(p.phone));
  if (p.vat_id) footerParts.push(`USt-ID: ${p.vat_id}`);

  const bodyChildren: Paragraph[] = [];

  bodyChildren.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: opts.title, bold: true, size: 36 })],
    spacing: { after: 240 },
  }));

  if (opts.reviewRequired) {
    bodyChildren.push(new Paragraph({
      children: [new TextRun({
        text: "ENTWURF — fachliche / juristische Prüfung empfohlen.",
        bold: true, color: "8C5A05",
      })],
      shading: { type: "clear", color: "auto", fill: "FCEDD5" },
      spacing: { after: 200 },
    }));
  }

  for (const s of sections) {
    if (s.title) {
      bodyChildren.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: s.title, bold: true, color: "1E40AF", size: 26 })],
        spacing: { before: 200, after: 120 },
      }));
    }
    for (const ln of s.lines) {
      if (!ln.trim()) {
        bodyChildren.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
        continue;
      }
      const cleaned = ln.replace(/^\s*[-*]\s+/, "• ");
      bodyChildren.push(new Paragraph({
        children: [new TextRun({ text: cleaned, size: 22 })],
        spacing: { after: 80 },
      }));
    }
  }

  if (p.default_sender_name || p.default_signature) {
    bodyChildren.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 240 } }));
    bodyChildren.push(new Paragraph({ children: [new TextRun({ text: "Mit freundlichen Grüßen", size: 22 })] }));
    bodyChildren.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 240 } }));
    if (p.default_sender_name) {
      bodyChildren.push(new Paragraph({ children: [new TextRun({ text: String(p.default_sender_name), bold: true, size: 22 })] }));
    }
    if (p.default_sender_role) {
      bodyChildren.push(new Paragraph({ children: [new TextRun({ text: String(p.default_sender_role), color: "6B7280", size: 20 })] }));
    }
    if (p.default_signature) {
      bodyChildren.push(new Paragraph({ children: [new TextRun({ text: String(p.default_signature), color: "6B7280", size: 20 })] }));
    }
  }

  const disclaimer = (p.disclaimer_text as string) ??
    "Dieses Dokument wurde KI-unterstützt erstellt und ist reviewfähig. Keine Garantie auf rechtliche Verbindlichkeit.";
  bodyChildren.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 200 } }));
  bodyChildren.push(new Paragraph({
    children: [new TextRun({ text: "Hinweis: " + disclaimer, italics: true, color: "6B7280", size: 18 })],
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB", space: 4 } },
  }));

  const doc = new Document({
    creator: "ExamFit@work · Berufs-KI",
    title: opts.title,
    styles: {
      default: { document: { run: { font: (p.font_family as string) ?? "Calibri", size: 22 } } },
    },
    sections: [{
      properties: { page: { margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } },
      headers: { default: new Header({ children: headerChildren }) },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: footerParts.join("  ·  "), color: "6B7280", size: 16 })],
          })],
        }),
      },
      children: bodyChildren,
    }],
  });

  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

// ─────── Main ───────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ExportRequest;
    if (!body.run_id || !["pdf", "docx"].includes(body.format)) {
      return new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Load run + template + profile (RLS via user_client to enforce ownership)
    const { data: run, error: runErr } = await userClient
      .from("document_agent_runs")
      .select("id,user_id,organization_id,template_id,profile_id,generated_document,structured_sections,review_required,compliance_warnings,status")
      .eq("id", body.run_id)
      .maybeSingle();
    if (runErr || !run) {
      return new Response(JSON.stringify({ error: "run_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!run.generated_document) {
      return new Response(JSON.stringify({ error: "run_not_generated" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: template } = await admin
      .from("document_agent_templates")
      .select("id,title,version,document_type")
      .eq("id", run.template_id)
      .maybeSingle();

    let profile: Record<string, unknown> | null = null;
    if (run.profile_id) {
      const { data: prof } = await admin
        .from("document_agent_profiles")
        .select("*")
        .eq("id", run.profile_id)
        .maybeSingle();
      profile = prof as Record<string, unknown> | null;
    }

    const title = (template?.title as string) ?? "Dokument";
    const compliance = Array.isArray(run.compliance_warnings)
      ? (run.compliance_warnings as Array<{ code: string; message: string }>)
      : [];

    let bytes: Uint8Array;
    let contentType: string;
    let ext: string;
    if (body.format === "pdf") {
      bytes = await renderPdf({
        title, body: run.generated_document, profile,
        reviewRequired: !!run.review_required, complianceWarnings: compliance,
      });
      contentType = "application/pdf";
      ext = "pdf";
    } else {
      bytes = await renderDocx({
        title, body: run.generated_document, profile,
        reviewRequired: !!run.review_required,
      });
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      ext = "docx";
    }

    const hash = await sha256Hex(bytes);
    const storagePath = `${user.id}/${run.id}/${Date.now()}-${hash.slice(0, 10)}.${ext}`;

    const { error: upErr } = await admin.storage
      .from("document-exports")
      .upload(storagePath, bytes, { contentType, upsert: false });
    if (upErr) throw upErr;

    const { data: signed } = await admin.storage
      .from("document-exports")
      .createSignedUrl(storagePath, 60 * 60);

    const layoutTemplate = ((profile?.layout_template as string) ?? "modern_corporate");
    const complianceLevel = ((profile?.compliance_level as string) ?? "standard");

    const { data: exp, error: expErr } = await admin
      .from("document_agent_exports")
      .insert({
        run_id: run.id,
        user_id: user.id,
        organization_id: run.organization_id,
        branding_profile_id: run.profile_id,
        template_id: run.template_id,
        template_version: (template?.version as number) ?? 1,
        export_format: body.format,
        layout_template: layoutTemplate,
        compliance_level: complianceLevel,
        review_required: !!run.review_required,
        storage_path: storagePath,
        byte_size: bytes.byteLength,
        export_hash: hash,
      })
      .select("id,export_hash,storage_path,byte_size")
      .single();
    if (expErr) throw expErr;

    // Update run status to exported if previously generated/approved
    if (["generated", "approved", "needs_review"].includes(run.status)) {
      await admin.from("document_agent_runs")
        .update({ status: "exported", export_format: body.format })
        .eq("id", run.id);
    }

    return new Response(JSON.stringify({
      ok: true,
      export_id: exp.id,
      export_hash: hash,
      format: body.format,
      byte_size: bytes.byteLength,
      signed_url: signed?.signedUrl ?? null,
      storage_path: storagePath,
      filename: `${title.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60)}.${ext}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[doc-export] error", msg);
    return new Response(JSON.stringify({ error: "export_failed", message: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
