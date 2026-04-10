import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * compute-revenue-profiles
 * Batch-computes user revenue profiles for all active users.
 * Can be triggered by cron or manually from admin.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.user_id as string | undefined;
    const curriculumId = body.curriculum_id as string | undefined;
    const limit = Math.min(body.limit ?? 100, 500);

    if (userId) {
      const { data } = await sb.rpc("fn_compute_user_revenue_profile", {
        p_user_id: userId,
        p_curriculum_id: curriculumId ?? null,
      });
      return json(200, { ok: true, computed: 1, result: data });
    }

    // Batch: get active users (had session in last 30d)
    const { data: users } = await sb
      .from("exam_sessions")
      .select("user_id, curriculum_id")
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .limit(limit);

    const seen = new Set<string>();
    let computed = 0;

    for (const u of users ?? []) {
      const key = `${u.user_id}:${u.curriculum_id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      await sb.rpc("fn_compute_user_revenue_profile", {
        p_user_id: u.user_id,
        p_curriculum_id: u.curriculum_id ?? null,
      });
      computed++;
    }

    return json(200, { ok: true, computed });
  } catch (e) {
    console.error("compute-revenue-profiles error:", e);
    return json(500, { error: e instanceof Error ? e.message : "unknown" });
  }

  function json(status: number, data: any) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
