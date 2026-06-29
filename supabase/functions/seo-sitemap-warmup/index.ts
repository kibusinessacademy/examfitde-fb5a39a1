// seo-sitemap-warmup — Pings sitemap to search engines + warms own sitemap routes.
// Uses shared TokenBucket + retry helper to stay polite and resilient.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { TokenBucket, rateLimitedFetch, retry } from "../_shared/retry-backoff.ts";

const SITE_URL = "https://berufos.com";
const SUB_SITEMAPS = [
  "/sitemap.xml",
  "/functions/v1/generate-sitemap?action=static",
  "/functions/v1/generate-sitemap?action=berufe",
  "/functions/v1/generate-sitemap?action=products",
  "/functions/v1/generate-sitemap?action=blog",
  "/functions/v1/generate-sitemap?action=landing",
  "/functions/v1/generate-sitemap?action=content",
];

const SEARCH_ENGINE_PINGS = (sitemapUrl: string) => [
  `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
  `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
];

const PROJECT_REF = "ubdvvvsiryenhrfmqsvw";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = new Date().toISOString();
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  // 2 req/sec, no burst
  const limiter = new TokenBucket({ tokensPerInterval: 2, intervalMs: 1000, capacity: 4 });
  const results: Array<{ url: string; kind: string; status: number; ok: boolean; error?: string }> = [];

  async function ping(url: string, kind: string) {
    if (dryRun) {
      results.push({ url, kind, status: 0, ok: true });
      return;
    }
    try {
      const res = await rateLimitedFetch(
        limiter,
        url,
        { method: "GET", headers: { "User-Agent": "ExamFit-Sitemap-Warmup/1.0" } },
        { maxAttempts: 4, baseDelayMs: 600, maxDelayMs: 15_000 },
      );
      results.push({ url, kind, status: res.status, ok: res.ok });
    } catch (e) {
      results.push({ url, kind, status: 0, ok: false, error: (e as Error).message });
    }
  }

  // 1. Warm our own sitemap routes (forces CDN / edge cache rebuild)
  for (const path of SUB_SITEMAPS) {
    const url = path.startsWith("/functions/")
      ? `https://${PROJECT_REF}.supabase.co${path}`
      : `${SITE_URL}${path}`;
    await ping(url, "warm");
  }

  // 2. Ping search engines for sitemap index
  const sitemapIndexUrl = `${SITE_URL}/sitemap.xml`;
  for (const pingUrl of SEARCH_ENGINE_PINGS(sitemapIndexUrl)) {
    await ping(pingUrl, "search_engine_ping");
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  await sb.from("auto_heal_log").insert({
    action_type: "seo_sitemap_warmup",
    target_type: "sitemap",
    result_status: failCount === 0 ? "success" : okCount > 0 ? "partial" : "failed",
    payload: {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      dry_run: dryRun,
      ok: okCount,
      failed: failCount,
      results,
    },
  }).then(() => {}).catch(() => {});

  return new Response(JSON.stringify({
    ok: failCount === 0,
    dry_run: dryRun,
    started_at: startedAt,
    pinged: results.length,
    succeeded: okCount,
    failed: failCount,
    results,
  }), { headers });
});
