import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-retry-failed-submissions – Retry failed SEO submissions with backoff
 *
 * Actions:
 *   retry_all   – Retry all failed (max 3 retries, prioritized)
 *   retry_one   – Retry a specific log entry by id
 *   list_failed – List failed submissions for admin
 */

const SITE_URL = "https://examfit.de";
const INDEXNOW_KEY = "examfit-indexnow-key-2026";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_RETRIES = 5;

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
  const action = body.action || "retry_all";

  try {
    if (action === "list_failed") {
      const { data, error } = await sb.from("seo_submission_logs")
        .select("*")
        .eq("status", "failed")
        .lt("retry_count", MAX_RETRIES)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, count: data?.length || 0, items: data }), { headers });
    }

    if (action === "retry_one") {
      const logId = body.log_id;
      if (!logId) return new Response(JSON.stringify({ error: "log_id required" }), { status: 400, headers });

      const { data: log } = await sb.from("seo_submission_logs")
        .select("*").eq("id", logId).single();
      if (!log) return new Response(JSON.stringify({ error: "Log not found" }), { status: 404, headers });

      if (log.provider === "indexnow" && log.url) {
        const result = await submitIndexNow([log.url]);
        await sb.from("seo_submission_logs").update({
          status: result.ok ? "success" : "failed",
          http_status: result.status,
          error_message: result.ok ? null : result.body?.slice(0, 500),
          retry_count: (log.retry_count || 0) + 1,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", logId);

        if (result.ok && log.source_type && log.source_id) {
          await sb.from("seo_discovery_state").update({
            last_submitted_via_indexnow_at: new Date().toISOString(),
            last_indexnow_status: "success",
          }).eq("source_type", log.source_type).eq("source_id", log.source_id);
        }

        return new Response(JSON.stringify({ ok: result.ok, retried: 1 }), { headers });
      }
      return new Response(JSON.stringify({ ok: false, error: "unsupported_provider" }), { headers });
    }

    // retry_all
    const { data: failed } = await sb.from("seo_submission_logs")
      .select("id, url, source_type, source_id, retry_count, provider")
      .eq("status", "failed")
      .eq("provider", "indexnow")
      .lt("retry_count", MAX_RETRIES)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50);

    if (!failed || failed.length === 0) {
      return new Response(JSON.stringify({ ok: true, retried: 0 }), { headers });
    }

    // Batch submit
    const urls = failed.map(f => f.url).filter(Boolean);
    const result = await submitIndexNow(urls);

    // Update all logs
    for (const f of failed) {
      await sb.from("seo_submission_logs").update({
        status: result.ok ? "success" : "failed",
        http_status: result.status,
        error_message: result.ok ? null : result.body?.slice(0, 500),
        retry_count: (f.retry_count || 0) + 1,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", f.id);

      // Update discovery state on success
      if (result.ok && f.source_type && f.source_id) {
        await sb.from("seo_discovery_state").update({
          last_submitted_via_indexnow_at: new Date().toISOString(),
          last_indexnow_status: "success",
        }).eq("source_type", f.source_type).eq("source_id", f.source_id);
      }
    }

    return new Response(JSON.stringify({
      ok: true, retried: failed.length, success: result.ok, http_status: result.status,
    }), { headers });

  } catch (err) {
    console.error("[seo-retry-failed-submissions] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
