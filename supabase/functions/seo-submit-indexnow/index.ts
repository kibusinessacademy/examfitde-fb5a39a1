import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-submit-indexnow – Submit URLs to IndexNow (Bing/Yandex)
 * 
 * Actions:
 *   submit_urls  – Submit array of URLs
 *   submit_new   – Auto-detect new/updated content and submit
 *   retry_failed – Retry failed submissions
 */

const SITE_URL = "https://examfit.de";
const INDEXNOW_KEY = "examfit-indexnow-key-2026";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

interface SubmissionResult {
  url: string;
  status: "success" | "failed" | "skipped";
  http_status?: number;
  error?: string;
}

async function submitToIndexNow(urls: string[]): Promise<{ ok: boolean; status: number; body?: string }> {
  if (urls.length === 0) return { ok: true, status: 200 };

  const payload = {
    host: new URL(SITE_URL).host,
    key: INDEXNOW_KEY,
    keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
    urlList: urls,
  };

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok || res.status === 202, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message };
  }
}

function computeDiscoveryHash(row: Record<string, unknown>): string {
  const parts = [
    String(row.canonical_url || row.slug || ""),
    String(row.title || row.meta_title || ""),
    String(row.meta_description || ""),
    String(row.status || ""),
    String(row.updated_at || ""),
  ].join("|");
  // Simple hash
  let h = 0;
  for (let i = 0; i < parts.length; i++) {
    h = ((h << 5) - h + parts.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const action = body.action || "submit_new";

  try {
    if (action === "submit_urls") {
      const urls: string[] = body.urls || [];
      if (urls.length === 0) return new Response(JSON.stringify({ ok: true, submitted: 0 }), { headers });

      const result = await submitToIndexNow(urls);
      
      // Log submissions
      for (const url of urls) {
        await sb.from("seo_submission_logs").insert({
          provider: "indexnow",
          source_type: "manual",
          url,
          action: "publish",
          status: result.ok ? "success" : "failed",
          http_status: result.status,
          error_message: result.ok ? null : result.body,
          submitted_at: new Date().toISOString(),
        }).then(() => {});
      }

      return new Response(JSON.stringify({
        ok: result.ok,
        submitted: urls.length,
        http_status: result.status,
      }), { headers });
    }

    if (action === "submit_new") {
      // Find content published/updated recently without a recent IndexNow submission
      const results: SubmissionResult[] = [];
      const urlsToSubmit: string[] = [];

      // 1. Blog articles
      const { data: blogs } = await sb
        .from("blog_articles")
        .select("id, slug, title, meta_description, status, updated_at")
        .eq("status", "published")
        .not("slug", "is", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      for (const b of blogs || []) {
        const url = `${SITE_URL}/blog/${b.slug}`;
        const hash = computeDiscoveryHash(b);

        // Check discovery state
        const { data: state } = await sb
          .from("seo_discovery_state")
          .select("last_discovery_hash, last_submitted_via_indexnow_at")
          .eq("source_type", "blog_post")
          .eq("source_id", b.id)
          .maybeSingle();

        if (state?.last_discovery_hash === hash) {
          results.push({ url, status: "skipped" });
          continue;
        }

        urlsToSubmit.push(url);

        // Upsert discovery state
        await sb.from("seo_discovery_state").upsert({
          source_type: "blog_post",
          source_id: b.id,
          canonical_url: url,
          is_indexable: true,
          in_sitemap: true,
          in_feed: true,
          last_discovery_hash: hash,
          last_submitted_via_indexnow_at: new Date().toISOString(),
        }, { onConflict: "source_type,source_id" });
      }

      // 2. SEO documents
      const { data: seoDocs } = await sb
        .from("seo_documents")
        .select("id, slug, doc_type, meta_title, meta_description, status, updated_at")
        .eq("status", "published")
        .not("slug", "is", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      const docTypeUrlMap: Record<string, string> = {
        blog: "/wissen", landing: "/pruefungstraining", faq: "/faq",
        glossary: "/glossar", product: "/produkt", cluster: "/wissen",
      };

      for (const d of seoDocs || []) {
        const basePath = docTypeUrlMap[d.doc_type] || "/wissen";
        const url = `${SITE_URL}${basePath}/${d.slug}`;
        const hash = computeDiscoveryHash(d);

        const { data: state } = await sb
          .from("seo_discovery_state")
          .select("last_discovery_hash")
          .eq("source_type", "seo_document")
          .eq("source_id", d.id)
          .maybeSingle();

        if (state?.last_discovery_hash === hash) {
          results.push({ url, status: "skipped" });
          continue;
        }

        urlsToSubmit.push(url);

        await sb.from("seo_discovery_state").upsert({
          source_type: "seo_document",
          source_id: d.id,
          canonical_url: url,
          is_indexable: true,
          in_sitemap: true,
          in_feed: d.doc_type === "blog" || d.doc_type === "landing",
          last_discovery_hash: hash,
          last_submitted_via_indexnow_at: new Date().toISOString(),
        }, { onConflict: "source_type,source_id" });
      }

      // Submit batch to IndexNow (max 10000 per batch)
      let submitResult = { ok: true, status: 200, body: "" };
      if (urlsToSubmit.length > 0) {
        submitResult = await submitToIndexNow(urlsToSubmit);

        // Log all submissions
        const logs = urlsToSubmit.map(url => ({
          provider: "indexnow",
          source_type: "auto_discovery",
          url,
          action: "publish",
          status: submitResult.ok ? "success" : "failed",
          http_status: submitResult.status,
          error_message: submitResult.ok ? null : submitResult.body?.slice(0, 500),
          submitted_at: new Date().toISOString(),
        }));
        if (logs.length > 0) {
          await sb.from("seo_submission_logs").insert(logs);
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        submitted: urlsToSubmit.length,
        skipped: results.filter(r => r.status === "skipped").length,
        indexnow_status: submitResult.status,
      }), { headers });
    }

    if (action === "retry_failed") {
      const { data: failed } = await sb
        .from("seo_submission_logs")
        .select("id, url, retry_count")
        .eq("status", "failed")
        .eq("provider", "indexnow")
        .lt("retry_count", 3)
        .order("created_at", { ascending: false })
        .limit(20);

      const urls = (failed || []).map(f => f.url);
      if (urls.length === 0) {
        return new Response(JSON.stringify({ ok: true, retried: 0 }), { headers });
      }

      const result = await submitToIndexNow(urls);

      for (const f of failed || []) {
        await sb.from("seo_submission_logs").update({
          status: result.ok ? "success" : "failed",
          http_status: result.status,
          retry_count: (f.retry_count || 0) + 1,
          submitted_at: new Date().toISOString(),
        }).eq("id", f.id);
      }

      return new Response(JSON.stringify({
        ok: true,
        retried: urls.length,
        success: result.ok,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  } catch (err) {
    console.error("[seo-submit-indexnow] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
