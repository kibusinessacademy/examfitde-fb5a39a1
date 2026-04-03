import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * distribution-webhook
 * Receives performance data from external tools (Buffer, Later, etc.)
 * or manual API calls. INSERT-ONLY snapshots into content_performance.
 *
 * POST body:
 * {
 *   content_type: "blog_article" | "video_script",
 *   content_id: "uuid",
 *   platform: "tiktok" | "instagram_reels" | "youtube_shorts" | "blog_seo",
 *   views?: number,
 *   clicks?: number,
 *   ctr?: number,        // decimal: 0.034 = 3.4%
 *   watch_time_seconds?: number,
 *   conversions?: number,
 *   revenue_eur?: number,
 *   likes?: number,
 *   comments?: number,
 *   shares?: number,
 *   saves?: number
 * }
 */
Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();

    if (!body.content_type || !body.content_id || !body.platform) {
      return json(400, { error: "content_type, content_id, and platform are required" }, origin);
    }

    const validTypes = ["blog_article", "video_script"];
    if (!validTypes.includes(body.content_type)) {
      return json(400, { error: `content_type must be one of: ${validTypes.join(", ")}` }, origin);
    }

    const today = new Date().toISOString().slice(0, 10);

    // Upsert per content+platform+day (snapshot_date unique index)
    const { error } = await sb
      .from("content_performance")
      .upsert(
        {
          content_type: body.content_type,
          content_id: body.content_id,
          platform: body.platform,
          snapshot_date: today,
          snapshot_at: new Date().toISOString(),
          views: body.views ?? 0,
          clicks: body.clicks ?? 0,
          ctr: body.ctr ?? 0,
          watch_time_seconds: body.watch_time_seconds ?? 0,
          conversions: body.conversions ?? 0,
          revenue_eur: body.revenue_eur ?? 0,
          likes: body.likes ?? 0,
          comments: body.comments ?? 0,
          shares: body.shares ?? 0,
          saves: body.saves ?? 0,
        },
        { onConflict: "content_type,content_id,platform,snapshot_date" }
      );

    if (error) return json(500, { error: error.message }, origin);

    return json(200, { ok: true, message: "Performance snapshot recorded" }, origin);
  } catch (e) {
    return json(500, { error: (e as Error).message }, origin);
  }
});
