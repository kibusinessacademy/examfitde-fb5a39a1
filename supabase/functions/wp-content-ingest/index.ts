import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * wp-content-ingest — Headless WordPress → ExamFit Content Ingest
 *
 * ONE-WAY sync: WP → ExamFit (SEO/Blog only). No write-back.
 * ExamFit remains SSOT for learning/exam data.
 *
 * Actions:
 *   sync_posts  — Fetch published WP posts and upsert into seo_pages
 *   sync_single — Fetch a single post by slug
 *   webhook     — Called by WP on publish/update (post_id in body)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wp-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface WPPost {
  id: number;
  slug: string;
  status: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  date: string;
  modified: string;
  categories: number[];
  tags: number[];
  featured_media: number;
  yoast_head_json?: {
    title?: string;
    description?: string;
    og_image?: Array<{ url: string }>;
    canonical?: string;
  };
  _embedded?: {
    "wp:featuredmedia"?: Array<{ source_url: string; alt_text: string }>;
    "wp:term"?: Array<Array<{ id: number; name: string; slug: string }>>;
  };
}

async function fetchWPPosts(wpUrl: string, params: Record<string, string> = {}): Promise<WPPost[]> {
  const url = new URL(`${wpUrl}/wp-json/wp/v2/posts`);
  url.searchParams.set("_embed", "1");
  url.searchParams.set("status", "publish");
  url.searchParams.set("per_page", params.per_page || "20");
  if (params.page) url.searchParams.set("page", params.page);
  if (params.slug) url.searchParams.set("slug", params.slug);
  if (params.after) url.searchParams.set("after", params.after);

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`WP API error: ${resp.status}`);
  return resp.json();
}

function wpPostToSeoPage(post: WPPost, wpUrl: string) {
  const yoast = post.yoast_head_json || {};
  const featuredImage = post._embedded?.["wp:featuredmedia"]?.[0];
  const categories = post._embedded?.["wp:term"]?.[0] || [];
  const tags = post._embedded?.["wp:term"]?.[1] || [];

  // Strip HTML tags for clean text
  const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").trim();

  return {
    slug: `wissen/${post.slug}`,
    title: stripHtml(post.title.rendered),
    meta_title: yoast.title || stripHtml(post.title.rendered),
    meta_description: yoast.description || stripHtml(post.excerpt.rendered).slice(0, 160),
    content_html: post.content.rendered,
    excerpt: stripHtml(post.excerpt.rendered),
    og_image: yoast.og_image?.[0]?.url || featuredImage?.source_url || null,
    canonical_url: yoast.canonical || `${wpUrl}/${post.slug}`,
    source: "wordpress",
    source_id: String(post.id),
    source_url: `${wpUrl}/${post.slug}`,
    categories: categories.map((c: any) => c.name),
    tags: tags.map((t: any) => t.name),
    published_at: post.date,
    updated_at: post.modified,
    status: "published",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const WP_URL = Deno.env.get("WP_BASE_URL");
  const WP_WEBHOOK_SECRET = Deno.env.get("WP_WEBHOOK_SECRET");

  if (!WP_URL) return json({ error: "WP_BASE_URL not configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const action = body.action || "sync_posts";

  try {
    // ── Webhook from WordPress ──
    if (action === "webhook") {
      // Verify webhook secret
      const secret = req.headers.get("x-wp-webhook-secret");
      if (WP_WEBHOOK_SECRET && secret !== WP_WEBHOOK_SECRET) {
        return json({ error: "Invalid webhook secret" }, 403);
      }

      const postId = body.post_id || body.ID;
      if (!postId) return json({ error: "post_id required" }, 400);

      const posts = await fetchWPPosts(WP_URL, { slug: body.post_name || "" });
      if (posts.length === 0) return json({ ok: true, skipped: true, reason: "Post not found or not published" });

      const page = wpPostToSeoPage(posts[0], WP_URL);
      const { error } = await sb.from("seo_pages").upsert(page, { onConflict: "slug" });
      if (error) throw error;

      return json({ ok: true, synced: 1, slug: page.slug });
    }

    // ── Sync single post by slug ──
    if (action === "sync_single") {
      const slug = body.slug;
      if (!slug) return json({ error: "slug required" }, 400);

      const posts = await fetchWPPosts(WP_URL, { slug });
      if (posts.length === 0) return json({ ok: false, error: "Post not found" }, 404);

      const page = wpPostToSeoPage(posts[0], WP_URL);
      const { error } = await sb.from("seo_pages").upsert(page, { onConflict: "slug" });
      if (error) throw error;

      return json({ ok: true, slug: page.slug });
    }

    // ── Bulk sync published posts ──
    if (action === "sync_posts") {
      const since = body.since; // ISO date string for incremental sync
      const perPage = Math.min(body.per_page || 20, 100);
      const page = body.page || "1";

      const params: Record<string, string> = { per_page: String(perPage), page };
      if (since) params.after = since;

      const posts = await fetchWPPosts(WP_URL, params);
      if (posts.length === 0) return json({ ok: true, synced: 0, message: "No new posts" });

      const pages = posts.map(p => wpPostToSeoPage(p, WP_URL));

      let synced = 0, errors: string[] = [];
      for (const p of pages) {
        const { error } = await sb.from("seo_pages").upsert(p, { onConflict: "slug" });
        if (error) { errors.push(`${p.slug}: ${error.message}`); } else { synced++; }
      }

      // Track last sync timestamp
      await sb.from("admin_actions").insert({
        action: "wp_content_sync",
        payload: { synced, errors: errors.length, total: posts.length, since, page },
      }).catch(() => {});

      return json({ ok: true, synced, errors: errors.length ? errors : undefined, total: posts.length, hasMore: posts.length === perPage });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[wp-content-ingest] Error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
