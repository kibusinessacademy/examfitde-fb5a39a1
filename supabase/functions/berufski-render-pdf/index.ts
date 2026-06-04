import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { buildPremiumHtml } from "../_shared/berufski-premium-template.ts";
import { buildCoverSvg, svgToDataUrl, getTierBadge, getTierSubtitle } from "../_shared/berufski-cover-svg.ts";
import type { ContentJson } from "../_shared/berufski-content-schema.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  try {
    const { productId, mode = "screen", licenseStamp } = await req.json();
    if (!productId) {
      return new Response(JSON.stringify({ error: "productId required" }), { status: 400, headers });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1) Load product + beruf ──
    const { data: product, error: prodErr } = await sb
      .from("work_produkte")
      .select("*, work_berufe(*)")
      .eq("id", productId)
      .single();

    if (prodErr || !product) {
      return new Response(JSON.stringify({ error: "Produkt nicht gefunden" }), { status: 404, headers });
    }

    const contentJson = product.content_json as ContentJson | null;
    if (!contentJson?.sections?.length) {
      return new Response(JSON.stringify({ error: "Kein content_json vorhanden. Bitte zuerst generieren." }), { status: 400, headers });
    }

    const beruf = product.work_berufe as Record<string, unknown>;

    // ── 2) Load theme ──
    let theme = { primary: "#0B7285", accent: "#20C997", font: "Inter", logoUrl: null as string | null, brandName: "ExamFit@work" };
    const themeId = product.theme_id;
    if (themeId) {
      const { data: dbTheme } = await sb.from("work_brand_themes").select("*").eq("id", themeId).maybeSingle();
      if (dbTheme) {
        theme = { primary: dbTheme.primary_color, accent: dbTheme.accent_color, font: dbTheme.font_heading || dbTheme.font_body || "Inter", logoUrl: dbTheme.logo_url, brandName: dbTheme.brand_name };
      }
    } else {
      const { data: defaultTheme } = await sb.from("work_brand_themes").select("*").eq("is_default", true).maybeSingle();
      if (defaultTheme) {
        theme = { primary: defaultTheme.primary_color, accent: defaultTheme.accent_color, font: defaultTheme.font_heading || defaultTheme.font_body || "Inter", logoUrl: defaultTheme.logo_url, brandName: defaultTheme.brand_name };
      }
    }

    // ── 3) Generate cover SVG ──
    const coverSvg = buildCoverSvg({
      title: `KI für ${beruf.name as string}`,
      subtitle: getTierSubtitle(product.tier),
      badge: getTierBadge(product.tier),
      primary: theme.primary,
      accent: theme.accent,
      brandName: theme.brandName,
    });
    const coverDataUrl = svgToDataUrl(coverSvg);

    // ── 4) Build HTML ──
    const startTime = Date.now();
    const html = buildPremiumHtml({
      content: contentJson,
      theme,
      coverDataUrl,
      licenseStamp: licenseStamp || null,
      examfitUrl: Deno.env.get("APP_BASE_URL") || "https://berufos.com",
    });

    // ── 5) Render PDF via Browserless ──
    const browserlessEndpoint = Deno.env.get("BROWSERLESS_ENDPOINT");
    let pdfBuffer: ArrayBuffer;
    let renderMethod: string;

    if (browserlessEndpoint) {
      const pdfResp = await fetch(browserlessEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html,
          options: {
            printBackground: true, format: "A4",
            margin: mode === "print" ? { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" } : undefined,
            preferCSSPageSize: true,
          },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!pdfResp.ok) {
        const errText = await pdfResp.text().catch(() => "");
        return new Response(JSON.stringify({ error: `PDF render failed: ${pdfResp.status}`, detail: errText.slice(0, 300) }), { status: 502, headers });
      }

      pdfBuffer = await pdfResp.arrayBuffer();
      renderMethod = "browserless";
    } else {
      const encoder = new TextEncoder();
      pdfBuffer = encoder.encode(html).buffer;
      renderMethod = "html_fallback";
    }

    const renderDuration = Date.now() - startTime;

    // ── 6) Upload to storage ──
    const berufSlug = (beruf.slug as string) || "unknown";
    const ext = renderMethod === "html_fallback" ? "html" : "pdf";
    const storagePath = `pdf/${berufSlug}/${product.tier}/${mode}_v${(product.pdf_version || 0) + 1}.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from("berufski-assets")
      .upload(storagePath, pdfBuffer, {
        contentType: ext === "pdf" ? "application/pdf" : "text/html",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[work-render-pdf] Upload error:", uploadErr);
      return new Response(JSON.stringify({ error: "Upload failed", detail: uploadErr.message }), { status: 500, headers });
    }

    // ── 7) Record export + update product ──
    const [exportRes, _updateRes] = await Promise.all([
      sb.from("work_pdf_exports").insert({
        product_id: productId, mode, storage_path: storagePath,
        template_id: product.template_id || null, theme_id: product.theme_id || null,
        render_duration_ms: renderDuration, file_size_bytes: pdfBuffer.byteLength,
        version: (product.pdf_version || 0) + 1,
      }).select("id").single(),
      sb.from("work_produkte").update({
        pdf_storage_path: storagePath, pdf_rendered_at: new Date().toISOString(),
        pdf_version: (product.pdf_version || 0) + 1,
        ...(mode === "screen" ? { screen_pdf_path: storagePath } : { print_pdf_path: storagePath }),
        status: "ready",
      }).eq("id", productId),
    ]);

    return new Response(JSON.stringify({
      ok: true, exportId: exportRes.data?.id, storagePath,
      fileSize: pdfBuffer.byteLength, renderMethod, renderDurationMs: renderDuration, mode,
    }), { headers });

  } catch (e) {
    console.error("[work-render-pdf] Error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers });
  }
});
