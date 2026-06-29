import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { TokenBucket, retry } from "../_shared/retry-backoff.ts";

// Politeness limiter: IndexNow accepts bursts but Bing throttles aggressive clients.
// 2 req/sec, soft burst of 4 = safe for chunked drains.
const INDEXNOW_LIMITER = new TokenBucket({ tokensPerInterval: 2, intervalMs: 1000, capacity: 4 });
const SITEMAP_FETCH_LIMITER = new TokenBucket({ tokensPerInterval: 4, intervalMs: 1000, capacity: 6 });

/**
 * seo-submit-indexnow – Submit URLs to IndexNow (Bing/Yandex)
 *
 * Actions:
 *   submit_urls       – Submit array of URLs (synchronous)
 *   submit_new        – Auto-detect new/updated content (legacy discovery loop)
 *   retry_failed      – Retry failed submissions (with exponential backoff cooldown)
 *   drain_pending     – Drain pending rows in seo_submission_logs (chunked, rate-limited)
 *   backfill_sitemap  – One-shot: enqueue every URL from sitemap.xml as pending
 *
 * Legacy: { drain: true } maps to drain_pending.
 */

const SITE_URL = "https://berufos.com";
const INDEXNOW_KEY = "examfit-indexnow-key-2026";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

// IndexNow allows up to 10 000 URLs/request; we keep chunks small for per-row tracking + clean failure attribution.
const DEFAULT_CHUNK = 50;
const MAX_CHUNK = 200;
const DEFAULT_DRAIN_LIMIT = 200;
const MAX_DRAIN_LIMIT = 1000;
// Pause between IndexNow calls to stay polite (ms)
const INTER_CHUNK_DELAY_MS = 400;

function normalizeToApex(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.host = "berufos.com";
    return u.toString();
  } catch {
    return url;
  }
}

async function submitToIndexNow(rawUrls: string[]): Promise<{ ok: boolean; status: number; body?: string; submitted_urls: string[] }> {
  const submitted_urls = Array.from(new Set(rawUrls.map(normalizeToApex).filter((u) => u.startsWith("https://berufos.com/"))));
  if (submitted_urls.length === 0) return { ok: true, status: 200, submitted_urls };

  const payload = {
    host: new URL(SITE_URL).host,
    key: INDEXNOW_KEY,
    keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
    urlList: submitted_urls,
  };

  try {
    await INDEXNOW_LIMITER.take();
    const res = await retry(async () => {
      const r = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.status >= 500 || r.status === 429) {
        throw new Error(`HTTP ${r.status} ${r.statusText}`);
      }
      return r;
    }, { maxAttempts: 4, baseDelayMs: 800, maxDelayMs: 20_000,
         onRetry: (e, a, w) => console.warn(`[indexnow.submit] retry attempt=${a} wait=${w}ms err=${(e as Error)?.message}`) });
    const body = await res.text().catch(() => "");
    return { ok: res.ok || res.status === 202, status: res.status, body, submitted_urls };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message, submitted_urls };
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
  let h = 0;
  for (let i = 0; i < parts.length; i++) {
    h = ((h << 5) - h + parts.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Drain pending rows ──────────────────────────────────────────────
async function drainPending(
  sb: ReturnType<typeof createClient>,
  limit: number,
  chunkSize: number,
): Promise<Record<string, unknown>> {
  const claimed = await sb
    .from("seo_submission_logs")
    .select("id, url, retry_count, source_type, created_at")
    .eq("provider", "indexnow")
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  const rows = claimed.data ?? [];
  if (rows.length === 0) {
    return { ok: true, action: "drain_pending", drained: 0, chunks: 0, success: 0, failed: 0 };
  }

  const ids = rows.map((r: any) => r.id);
  const startedAt = new Date().toISOString();
  await sb
    .from("seo_submission_logs")
    .update({ started_at: startedAt, updated_at: startedAt })
    .in("id", ids);

  let totalSuccess = 0;
  let totalFailed = 0;
  const chunkResults: Array<{ chunk: number; size: number; http_status: number; ok: boolean; error?: string }> = [];

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const urls = chunk.map((r: any) => r.url);
    const result = await submitToIndexNow(urls);
    const finishedAt = new Date().toISOString();

    const updatePayload = {
      status: result.ok ? "success" : "failed",
      http_status: result.status,
      error_message: result.ok ? null : (result.body ?? "").toString().slice(0, 500),
      submitted_at: finishedAt,
      finished_at: finishedAt,
      updated_at: finishedAt,
      retry_count: undefined as number | undefined,
    };

    // Bulk update by id list (status/http) – retry_count must be bumped per-row only on failure.
    if (result.ok) {
      await sb
        .from("seo_submission_logs")
        .update({
          status: "success",
          http_status: result.status,
          error_message: null,
          submitted_at: finishedAt,
          finished_at: finishedAt,
          updated_at: finishedAt,
        })
        .in("id", chunk.map((r: any) => r.id));
      totalSuccess += chunk.length;
    } else {
      // Per-row failure update with retry_count++
      for (const r of chunk as any[]) {
        await sb
          .from("seo_submission_logs")
          .update({
            status: "failed",
            http_status: result.status,
            error_message: (result.body ?? "").toString().slice(0, 500),
            finished_at: finishedAt,
            updated_at: finishedAt,
            retry_count: (r.retry_count ?? 0) + 1,
          })
          .eq("id", r.id);
      }
      totalFailed += chunk.length;
    }

    chunkResults.push({
      chunk: Math.floor(i / chunkSize) + 1,
      size: chunk.length,
      http_status: result.status,
      ok: result.ok,
      error: result.ok ? undefined : (result.body ?? "").toString().slice(0, 200),
    });

    if (i + chunkSize < rows.length) await sleep(INTER_CHUNK_DELAY_MS);
  }

  // Audit summary
  await sb.from("auto_heal_log").insert({
    action_type: "indexnow_drain_pending",
    target_type: "seo_submission_logs",
    target_id: null,
    result_status: totalFailed === 0 ? "success" : (totalSuccess > 0 ? "partial" : "failed"),
    payload: {
      drained: rows.length,
      success: totalSuccess,
      failed: totalFailed,
      chunks: chunkResults,
      limit,
      chunk_size: chunkSize,
    },
  }).then(() => {}).catch(() => {});

  return {
    ok: true,
    action: "drain_pending",
    drained: rows.length,
    chunks: chunkResults.length,
    success: totalSuccess,
    failed: totalFailed,
    chunk_results: chunkResults,
  };
}

// ─── Backfill sitemap → pending rows ─────────────────────────────────
async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  try {
    await SITEMAP_FETCH_LIMITER.take();
    const res = await retry(
      () => fetch(sitemapUrl, { headers: { "User-Agent": "ExamFit-IndexNow-Backfill/1.0" } }),
      { maxAttempts: 3, baseDelayMs: 400, maxDelayMs: 5_000,
        onRetry: (e, a, w) => console.warn(`[indexnow.sitemap] retry ${sitemapUrl} attempt=${a} wait=${w}ms err=${(e as Error)?.message}`) },
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const matches = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).map((m) => m[1]);
    return matches;
  } catch {
    return [];
  }
}

async function backfillSitemap(
  sb: ReturnType<typeof createClient>,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  // 1. Load sitemap index
  const indexUrls = await fetchSitemapUrls(`${SITE_URL}/sitemap.xml`);
  const allUrls = new Set<string>();
  const perSubSitemap: Record<string, number> = {};

  for (const subUrl of indexUrls) {
    const urls = await fetchSitemapUrls(subUrl);
    perSubSitemap[subUrl] = urls.length;
    for (const u of urls) allUrls.add(normalizeToApex(u));
  }

  const allUrlList = Array.from(allUrls).filter((u) => u.startsWith("https://berufos.com/"));

  // 2. Filter URLs already submitted successfully in last 30d OR pending
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Chunked existence check (Supabase IN-list cap ~1000)
  const skipUrls = new Set<string>();
  const checkChunk = 800;
  for (let i = 0; i < allUrlList.length; i += checkChunk) {
    const slice = allUrlList.slice(i, i + checkChunk);
    const { data: existing } = await sb
      .from("seo_submission_logs")
      .select("url, status")
      .eq("provider", "indexnow")
      .in("url", slice)
      .or(`status.eq.pending,and(status.eq.success,submitted_at.gte.${since})`);
    for (const r of existing ?? []) {
      if (r.status === "pending" || r.status === "success") skipUrls.add(r.url);
    }
  }
  const toEnqueue = allUrlList.filter((u) => !skipUrls.has(u));

  if (dryRun) {
    return {
      ok: true,
      action: "backfill_sitemap",
      dry_run: true,
      sitemap_total: allUrlList.length,
      already_covered: skipUrls.size,
      would_enqueue: toEnqueue.length,
      per_sub_sitemap: perSubSitemap,
    };
  }

  // 3. Insert in chunks of 500
  const insertChunk = 500;
  let inserted = 0;
  for (let i = 0; i < toEnqueue.length; i += insertChunk) {
    const slice = toEnqueue.slice(i, i + insertChunk);
    const rows = slice.map((u) => ({
      provider: "indexnow",
      source_type: "sitemap_backfill",
      url: u,
      canonical_url: u,
      action: "submit",
      status: "pending",
      priority: 200,
      request_payload: { triggered_by: "backfill_sitemap_v1" },
    }));
    const { error } = await sb.from("seo_submission_logs").insert(rows);
    if (!error) inserted += rows.length;
  }

  await sb.from("auto_heal_log").insert({
    action_type: "indexnow_backfill_sitemap",
    target_type: "seo_submission_logs",
    result_status: "success",
    payload: {
      sitemap_total: allUrlList.length,
      already_covered: skipUrls.size,
      enqueued: inserted,
      per_sub_sitemap: perSubSitemap,
    },
  }).then(() => {}).catch(() => {});

  return {
    ok: true,
    action: "backfill_sitemap",
    sitemap_total: allUrlList.length,
    already_covered: skipUrls.size,
    enqueued: inserted,
    per_sub_sitemap: perSubSitemap,
  };
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
  let action: string = body.action || (body.drain === true ? "drain_pending" : "submit_new");

  try {
    if (action === "drain_pending") {
      const limit = Math.min(Number(body.limit) || DEFAULT_DRAIN_LIMIT, MAX_DRAIN_LIMIT);
      const chunkSize = Math.min(Number(body.chunk_size) || DEFAULT_CHUNK, MAX_CHUNK);
      const result = await drainPending(sb, limit, chunkSize);
      return new Response(JSON.stringify(result), { headers });
    }

    if (action === "backfill_sitemap") {
      const dryRun = body.dry_run === true;
      const result = await backfillSitemap(sb, dryRun);
      return new Response(JSON.stringify(result), { headers });
    }

    if (action === "submit_urls") {
      const urls: string[] = body.urls || [];
      if (urls.length === 0) return new Response(JSON.stringify({ ok: true, submitted: 0 }), { headers });

      const result = await submitToIndexNow(urls);
      const finishedAt = new Date().toISOString();
      const logs = result.submitted_urls.map((url) => ({
        provider: "indexnow",
        source_type: "manual",
        url,
        canonical_url: url,
        action: "publish",
        status: result.ok ? "success" : "failed",
        http_status: result.status,
        error_message: result.ok ? null : (result.body ?? "").toString().slice(0, 500),
        submitted_at: finishedAt,
        finished_at: finishedAt,
      }));
      if (logs.length > 0) await sb.from("seo_submission_logs").insert(logs);

      return new Response(JSON.stringify({
        ok: result.ok,
        submitted: result.submitted_urls.length,
        http_status: result.status,
      }), { headers });
    }

    if (action === "submit_new") {
      const urlsToSubmit: string[] = [];
      let skippedHash = 0;

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
        const { data: state } = await sb
          .from("seo_discovery_state")
          .select("last_discovery_hash")
          .eq("source_type", "blog_post")
          .eq("source_id", b.id)
          .maybeSingle();

        if (state?.last_discovery_hash === hash) { skippedHash++; continue; }
        urlsToSubmit.push(url);

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
        if (state?.last_discovery_hash === hash) { skippedHash++; continue; }
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

      let submitResult = { ok: true, status: 200, body: "", submitted_urls: [] as string[] };
      if (urlsToSubmit.length > 0) {
        submitResult = await submitToIndexNow(urlsToSubmit);
        const finishedAt = new Date().toISOString();
        const logs = submitResult.submitted_urls.map((url) => ({
          provider: "indexnow",
          source_type: "auto_discovery",
          url,
          canonical_url: url,
          action: "publish",
          status: submitResult.ok ? "success" : "failed",
          http_status: submitResult.status,
          error_message: submitResult.ok ? null : (submitResult.body ?? "").toString().slice(0, 500),
          submitted_at: finishedAt,
          finished_at: finishedAt,
        }));
        if (logs.length > 0) await sb.from("seo_submission_logs").insert(logs);
      }

      return new Response(JSON.stringify({
        ok: true,
        submitted: submitResult.submitted_urls.length,
        skipped_hash: skippedHash,
        indexnow_status: submitResult.status,
      }), { headers });
    }

    if (action === "retry_failed") {
      // Exponential backoff: cooldown = 5 min * 2^retry_count, max 24h
      const { data: failed } = await sb
        .from("seo_submission_logs")
        .select("id, url, retry_count, updated_at")
        .eq("status", "failed")
        .eq("provider", "indexnow")
        .lt("retry_count", 5)
        .order("updated_at", { ascending: true })
        .limit(50);

      const eligible = (failed ?? []).filter((f: any) => {
        const cooldownMs = Math.min(5 * 60 * 1000 * Math.pow(2, f.retry_count ?? 0), 24 * 60 * 60 * 1000);
        const lastTry = new Date(f.updated_at ?? 0).getTime();
        return Date.now() - lastTry >= cooldownMs;
      }).slice(0, 20);

      if (eligible.length === 0) {
        return new Response(JSON.stringify({ ok: true, retried: 0, reason: "all_in_cooldown_or_max_retries" }), { headers });
      }

      const urls = eligible.map((f: any) => f.url);
      const result = await submitToIndexNow(urls);
      const finishedAt = new Date().toISOString();

      for (const f of eligible as any[]) {
        await sb.from("seo_submission_logs").update({
          status: result.ok ? "success" : "failed",
          http_status: result.status,
          error_message: result.ok ? null : (result.body ?? "").toString().slice(0, 500),
          retry_count: (f.retry_count || 0) + 1,
          submitted_at: finishedAt,
          finished_at: finishedAt,
          updated_at: finishedAt,
        }).eq("id", f.id);
      }

      return new Response(JSON.stringify({
        ok: true,
        retried: eligible.length,
        success: result.ok,
        http_status: result.status,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers });
  } catch (err) {
    console.error("[seo-submit-indexnow] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
