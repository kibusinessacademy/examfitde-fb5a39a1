import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth } from "../_shared/auth.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * admin-production-wave-detail — Returns wave metadata + items with joins.
 */

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  const auth = await validateAuth(req, true);
  if (auth.error || !auth.isAdmin) {
    return json(401, { error: auth.error || "Admin required" }, origin);
  }

  const body = await req.json().catch(() => ({}));
  const waveId: string | null = body.wave_id || null;
  const statusFilter: string | null = body.status || null;
  const limit: number = Math.min(Number(body.limit || 200), 1000);

  if (!waveId) {
    return json(400, { error: "wave_id required" }, origin);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: wave, error: waveErr } = await sb
    .from("production_waves")
    .select("*")
    .eq("id", waveId)
    .single();

  if (waveErr || !wave) {
    return json(404, { error: "Wave not found" }, origin);
  }

  let query = sb
    .from("production_wave_items")
    .select(`
      *,
      curricula:curriculum_id(id, title),
      course_packages:package_id(id, title, status, build_progress, published_at, updated_at)
    `)
    .eq("wave_id", waveId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data: items, error: itemsErr } = await query;
  if (itemsErr) {
    return json(500, { error: itemsErr.message }, origin);
  }

  const byStatus: Record<string, number> = {};
  for (const item of items || []) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }

  return json(200, {
    ok: true,
    wave: {
      id: wave.id,
      name: wave.name,
      status: wave.status,
      target_count: wave.target_count,
      seeded_count: wave.seeded_count,
      completed_count: wave.completed_count,
      failed_count: wave.failed_count,
      published_count: wave.published_count,
      blocked_count: wave.blocked_count,
      max_concurrent: wave.max_concurrent,
      started_at: wave.started_at,
      finished_at: wave.finished_at,
      meta: wave.meta,
    },
    by_status: byStatus,
    items: (items || []).map((i: any) => ({
      id: i.id,
      status: i.status,
      priority: i.priority,
      curriculum_id: i.curriculum_id,
      curriculum_title: i.curricula?.title ?? i.curriculum_id,
      package_id: i.package_id,
      package_title: i.course_packages?.title ?? null,
      package_status: i.course_packages?.status ?? null,
      build_progress: i.course_packages?.build_progress ?? null,
      published_at: i.course_packages?.published_at ?? null,
      package_updated_at: i.course_packages?.updated_at ?? null,
      quality_score: i.quality_score ?? null,
      last_error: i.last_error ?? null,
      started_at: i.started_at,
      finished_at: i.finished_at,
    })),
  }, origin);
});
