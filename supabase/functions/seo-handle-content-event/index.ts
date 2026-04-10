import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-handle-content-event – Central SEO Control Layer event handler
 *
 * Events: publish, update, delete, archive, restore, noindex_changed, canonical_changed, slug_changed
 * Uses DB functions for classification, hashing, drift detection.
 * Orchestrates: discovery state → IndexNow → sitemap/feed logs
 */

const SITE_URL = "https://examfit.de";
const INDEXNOW_KEY = "examfit-indexnow-key-2026";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

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
  const { event, source_type, source_id, force, changed_fields } = body;

  if (!event || !source_type || !source_id) {
    return new Response(JSON.stringify({ error: "event, source_type, source_id required" }), { status: 400, headers });
  }

  try {
    // ── Delete / Archive / NoIndex → deactivate discovery ──
    if (event === "delete" || event === "archive" || event === "noindex") {
      // Classify to get canonical URL
      const { data: classified } = await sb.rpc("fn_classify_discovery_state", {
        p_source_type: source_type, p_source_id: source_id,
      });
      const canonicalUrl = classified?.canonical_url || body.url || "";

      await sb.from("seo_discovery_state").upsert({
        source_type, source_id, canonical_url: canonicalUrl,
        normalized_url: canonicalUrl.toLowerCase().replace(/\/+$/, ""),
        url_hash: "", // will be recomputed
        discovery_hash: "",
        content_status: event === "delete" ? "deleted" : event === "archive" ? "archived" : "noindex",
        is_indexable: false, is_sitemap_relevant: false, is_feed_relevant: false, is_indexnow_relevant: false,
        in_sitemap: false, in_feed: false,
        last_discovery_event_at: new Date().toISOString(),
        drift_status: "ok", drift_reasons: [],
        updated_at: new Date().toISOString(),
      }, { onConflict: "source_type,source_id" });

      // Submit deletion to IndexNow
      let indexResult = { ok: true, status: 200, body: "" };
      if (canonicalUrl) {
        indexResult = await submitIndexNow([canonicalUrl]);
      }

      await sb.from("seo_submission_logs").insert({
        provider: "indexnow", source_type, source_id, url: canonicalUrl,
        canonical_url: canonicalUrl,
        action: event, status: indexResult.ok ? "success" : "failed",
        http_status: indexResult.status,
        error_message: indexResult.ok ? null : indexResult.body?.slice(0, 500),
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ ok: true, action: event, url: canonicalUrl, indexnow: indexResult.ok }), { headers });
    }

    // ── Publish / Update / Restore / Changed fields ──
    // Step 1: Classify via DB function
    const { data: classified, error: classErr } = await sb.rpc("fn_classify_discovery_state", {
      p_source_type: source_type, p_source_id: source_id,
    });

    if (classErr || classified?.error) {
      return new Response(JSON.stringify({
        error: "Classification failed",
        detail: classErr?.message || classified?.error,
      }), { status: 404, headers });
    }

    const canonicalUrl = classified.canonical_url;
    const newHash = classified.discovery_hash;
    const isIndexable = classified.is_indexable;

    // Step 2: Check existing state for hash comparison
    const { data: existing } = await sb.from("seo_discovery_state")
      .select("discovery_hash, last_discovery_hash")
      .eq("source_type", source_type).eq("source_id", source_id).maybeSingle();

    const oldHash = existing?.discovery_hash || existing?.last_discovery_hash;
    const hashChanged = !oldHash || oldHash !== newHash;

    if (!force && !hashChanged) {
      // Log skip
      await sb.from("seo_submission_logs").insert({
        provider: "discovery_recalc", source_type, source_id, url: canonicalUrl,
        canonical_url: canonicalUrl, action: "skipped", status: "skipped",
        request_payload: { reason: "hash_unchanged", hash: newHash },
        started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({
        ok: true, action: "skipped", reason: "hash_unchanged", url: canonicalUrl, hash: newHash,
      }), { headers });
    }

    // Step 3: Upsert discovery state via DB function
    const { data: upsertResult } = await sb.rpc("fn_upsert_seo_discovery_state", {
      p_source_type: source_type, p_source_id: source_id, p_force: !!force,
    });

    // Step 4: Compute health score
    let healthScore = 0;
    if (isIndexable) healthScore += 20;
    if (canonicalUrl) healthScore += 20;
    if (classified.is_sitemap_relevant) healthScore += 20;
    if (classified.is_feed_relevant) healthScore += 20;
    healthScore += 20; // will be submitted

    // Update health score
    await sb.from("seo_discovery_state").update({
      discovery_health_score: healthScore,
      last_seen_live_at: new Date().toISOString(),
    }).eq("source_type", source_type).eq("source_id", source_id);

    // Step 5: IndexNow submit (only if indexable and hash changed)
    let indexResult = { ok: true, status: 200, body: "" };
    if (isIndexable && (hashChanged || force)) {
      indexResult = await submitIndexNow([canonicalUrl]);

      // Update IndexNow timestamps
      await sb.from("seo_discovery_state").update({
        last_submitted_via_indexnow_at: new Date().toISOString(),
        last_indexnow_status: indexResult.ok ? "success" : "failed",
      }).eq("source_type", source_type).eq("source_id", source_id);

      // Log IndexNow
      await sb.from("seo_submission_logs").insert({
        provider: "indexnow", source_type, source_id, url: canonicalUrl,
        canonical_url: canonicalUrl,
        action: event, status: indexResult.ok ? "success" : "failed",
        http_status: indexResult.status,
        error_message: indexResult.ok ? null : indexResult.body?.slice(0, 500),
        request_payload: { urls: [canonicalUrl], force: !!force },
        started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        priority: event === "publish" ? 10 : 50,
      });
    }

    // Step 6: Log sitemap refresh intent
    if (classified.is_sitemap_relevant) {
      await sb.from("seo_submission_logs").insert({
        provider: "sitemap_refresh", source_type, source_id, url: canonicalUrl,
        canonical_url: canonicalUrl,
        action: event, status: "success",
        started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      });
      await sb.from("seo_discovery_state").update({
        last_sitemap_refresh_at: new Date().toISOString(),
      }).eq("source_type", source_type).eq("source_id", source_id);
    }

    // Step 7: Log feed refresh intent
    if (classified.is_feed_relevant) {
      await sb.from("seo_submission_logs").insert({
        provider: "feed_refresh", source_type, source_id, url: canonicalUrl,
        canonical_url: canonicalUrl,
        action: event, status: "success",
        started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      });
      await sb.from("seo_discovery_state").update({
        last_feed_refresh_at: new Date().toISOString(),
      }).eq("source_type", source_type).eq("source_id", source_id);
    }

    return new Response(JSON.stringify({
      ok: true, event, url: canonicalUrl,
      hash: newHash, old_hash: oldHash, hash_changed: hashChanged,
      health_score: healthScore,
      indexnow: indexResult.ok,
      is_indexable: isIndexable,
      is_sitemap: classified.is_sitemap_relevant,
      is_feed: classified.is_feed_relevant,
    }), { headers });

  } catch (err) {
    console.error("[seo-handle-content-event] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
