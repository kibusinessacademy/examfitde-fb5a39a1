import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-handle-content-event – Central handler for publish/update/delete events
 *
 * Triggered by admin or DB triggers when content changes.
 * Orchestrates: discovery state update → IndexNow submit → sitemap/feed log
 *
 * Body:
 *   event:       "publish" | "update" | "delete" | "archive" | "noindex"
 *   source_type: "blog_post" | "content_page" | "seo_document" | "product"
 *   source_id:   UUID
 *   url:         canonical URL (optional, auto-resolved)
 *   force:       boolean (skip hash check)
 */

const SITE_URL = "https://examfit.de";
const INDEXNOW_KEY = "examfit-indexnow-key-2026";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

function computeHash(row: Record<string, unknown>): string {
  const parts = [
    String(row.canonical_url || row.slug || ""),
    String(row.title || row.meta_title || ""),
    String(row.meta_title || ""),
    String(row.meta_description || ""),
    String(row.status || ""),
    String(row.noindex || false),
    String(row.updated_at || ""),
  ].join("|");
  let h = 0;
  for (let i = 0; i < parts.length; i++) {
    h = ((h << 5) - h + parts.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

async function submitIndexNow(urls: string[]): Promise<{ ok: boolean; status: number; body?: string }> {
  if (urls.length === 0) return { ok: true, status: 200 };
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: new URL(SITE_URL).host, key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok || res.status === 202, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message };
  }
}

interface ContentRow {
  slug: string;
  title?: string;
  meta_title?: string;
  meta_description?: string;
  status: string;
  noindex?: boolean;
  updated_at: string;
  canonical_url?: string;
  doc_type?: string;
  page_type?: string;
  og_image_url?: string;
}

async function resolveContent(
  sb: ReturnType<typeof createClient>,
  sourceType: string,
  sourceId: string,
): Promise<{ row: ContentRow | null; url: string }> {
  const typeMap: Record<string, string> = { blog: "/wissen", landing: "/pruefungstraining", faq: "/faq", glossary: "/glossar", cluster: "/wissen" };

  if (sourceType === "blog_post") {
    // Try blog_articles first, then blog_posts
    const { data: a } = await sb.from("blog_articles")
      .select("slug, title, meta_description, status, updated_at, noindex, canonical_url")
      .eq("id", sourceId).maybeSingle();
    if (a) return { row: a as ContentRow, url: `${SITE_URL}/blog/${a.slug}` };
    const { data: p } = await sb.from("blog_posts")
      .select("slug, title, meta_title, meta_description, status, updated_at, noindex, canonical_url")
      .eq("id", sourceId).maybeSingle();
    if (p) return { row: p as ContentRow, url: `${SITE_URL}/blog/${p.slug}` };
  }

  if (sourceType === "seo_document") {
    const { data: d } = await sb.from("seo_documents")
      .select("slug, doc_type, meta_title, meta_description, status, updated_at, noindex, canonical_url")
      .eq("id", sourceId).maybeSingle();
    if (d) {
      const base = typeMap[d.doc_type] || "/wissen";
      return { row: d as ContentRow, url: d.canonical_url || `${SITE_URL}${base}/${d.slug}` };
    }
  }

  if (sourceType === "content_page") {
    const { data: cp } = await sb.from("content_pages")
      .select("slug, title, meta_title, meta_description, status, updated_at, noindex, canonical_url, page_type")
      .eq("id", sourceId).maybeSingle();
    if (cp) return { row: cp as ContentRow, url: cp.canonical_url || `${SITE_URL}/${cp.slug}` };
  }

  if (sourceType === "product") {
    const { data: p } = await sb.from("products")
      .select("slug, title, description, status, updated_at")
      .eq("id", sourceId).maybeSingle();
    if (p) return { row: { ...p, meta_description: p.description } as ContentRow, url: `${SITE_URL}/produkt/${p.slug}` };
  }

  return { row: null, url: "" };
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
  const { event, source_type, source_id, force } = body;

  if (!event || !source_type || !source_id) {
    return new Response(JSON.stringify({ error: "event, source_type, source_id required" }), { status: 400, headers });
  }

  try {
    const { row, url: resolvedUrl } = await resolveContent(sb, source_type, source_id);
    const canonicalUrl = body.url || resolvedUrl;

    if (!canonicalUrl) {
      return new Response(JSON.stringify({ error: "Could not resolve URL", source_type, source_id }), { status: 404, headers });
    }

    // Delete / Archive / NoIndex → remove from discovery
    if (event === "delete" || event === "archive" || event === "noindex") {
      await sb.from("seo_discovery_state").upsert({
        source_type, source_id, canonical_url: canonicalUrl,
        is_indexable: false, in_sitemap: false, in_feed: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "source_type,source_id" });

      // Submit deletion to IndexNow
      const indexResult = await submitIndexNow([canonicalUrl]);
      await sb.from("seo_submission_logs").insert({
        provider: "indexnow", source_type, source_id, url: canonicalUrl,
        action: "delete", status: indexResult.ok ? "success" : "failed",
        http_status: indexResult.status, error_message: indexResult.ok ? null : indexResult.body?.slice(0, 500),
        submitted_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ ok: true, action: event, url: canonicalUrl, indexnow: indexResult.ok }), { headers });
    }

    // Publish / Update
    if (!row) {
      return new Response(JSON.stringify({ error: "Content not found", source_type, source_id }), { status: 404, headers });
    }

    const isIndexable = row.status === "published" && !row.noindex;
    const newHash = computeHash({ ...row, canonical_url: canonicalUrl });

    // Check existing state for hash comparison
    const { data: existing } = await sb.from("seo_discovery_state")
      .select("last_discovery_hash").eq("source_type", source_type).eq("source_id", source_id).maybeSingle();

    if (!force && existing?.last_discovery_hash === newHash) {
      return new Response(JSON.stringify({ ok: true, action: "skipped", reason: "hash_unchanged", url: canonicalUrl }), { headers });
    }

    // Calculate health score
    let healthScore = 0;
    if (isIndexable) healthScore += 20;
    if (canonicalUrl) healthScore += 20;
    healthScore += 20; // in_sitemap (will be true)
    if (source_type === "blog_post" || row.doc_type === "landing") healthScore += 20; // in_feed
    healthScore += 20; // will be submitted via IndexNow

    // Detect drift issues
    const driftIssues: string[] = [];
    if (isIndexable && row.noindex) driftIssues.push("noindex_but_published");
    if (!canonicalUrl) driftIssues.push("missing_canonical");
    if (!row.meta_description && !row.meta_title) driftIssues.push("missing_meta");

    // Upsert discovery state
    const inFeed = source_type === "blog_post" || row.doc_type === "blog" || row.doc_type === "landing";
    await sb.from("seo_discovery_state").upsert({
      source_type, source_id, canonical_url: canonicalUrl,
      is_indexable: isIndexable, in_sitemap: isIndexable, in_feed: inFeed && isIndexable,
      last_discovery_hash: newHash,
      last_submitted_via_indexnow_at: new Date().toISOString(),
      last_sitemap_refresh_at: new Date().toISOString(),
      last_feed_refresh_at: inFeed ? new Date().toISOString() : undefined,
      discovery_health_score: healthScore,
      drift_issues: driftIssues,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_type,source_id" });

    // Submit to IndexNow
    let indexResult = { ok: true, status: 200, body: "" };
    if (isIndexable) {
      indexResult = await submitIndexNow([canonicalUrl]);
    }

    // Log submission
    await sb.from("seo_submission_logs").insert({
      provider: "indexnow", source_type, source_id, url: canonicalUrl,
      action: event, status: indexResult.ok ? "success" : "failed",
      http_status: indexResult.status,
      error_message: indexResult.ok ? null : indexResult.body?.slice(0, 500),
      submitted_at: new Date().toISOString(),
    });

    // Log sitemap refresh
    await sb.from("seo_submission_logs").insert({
      provider: "sitemap_refresh", source_type, source_id, url: canonicalUrl,
      action: event, status: "success", submitted_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      ok: true, event, url: canonicalUrl,
      hash: newHash, health_score: healthScore,
      indexnow: indexResult.ok, drift_issues: driftIssues,
    }), { headers });
  } catch (err) {
    console.error("[seo-handle-content-event] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
