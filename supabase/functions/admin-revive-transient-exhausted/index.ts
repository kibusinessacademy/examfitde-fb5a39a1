// supabase/functions/admin-revive-transient-exhausted/index.ts
// Auto-cancels transient-exhausted lesson_generate_content jobs
// so that the dispatcher can safely re-enqueue them.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  // Internal auth (fail-hard)
  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const expectedSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") ?? "";
  if (!expectedSecret) return json({ error: "MISSING_EDGE_INTERNAL_SHARED_SECRET" }, 500);
  if (!internalSecret || internalSecret !== expectedSecret) return json({ error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "MISSING_SUPABASE_ENV" }, 500);

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const body = await req.json().catch(() => ({}));
  const windowHours = Number.isFinite(body?.window_hours) ? Number(body.window_hours) : 6;
  const dryRun = body?.dry_run === true;

  // 1) Find exhausted-failed candidates in window
  const { data: exhaustedRows, error: exhaustedErr } = await sb
    .from("job_queue")
    .select("id, payload, meta, created_at, last_error")
    .eq("job_type", "lesson_generate_content")
    .eq("status", "failed")
    .gte("created_at", new Date(Date.now() - windowHours * 3600_000).toISOString())
    .filter("meta->>transient_exhausted", "eq", "true")
    .limit(500);

  if (exhaustedErr) return json({ error: "DB_READ_FAILED", details: exhaustedErr }, 500);

  const candidates = exhaustedRows ?? [];
  const cancelled: string[] = [];
  const skippedActiveDupe: string[] = [];

  // 2) For each candidate, cancel only if no active dupe exists (lesson_id + step_key)
  for (const row of candidates) {
    const payload = row.payload as Record<string, unknown> | null;
    const lessonId = (payload?.lesson_id as string) ?? "";
    const stepKey = (payload?.step_key as string) ?? "";
    if (!lessonId || !stepKey) {
      skippedActiveDupe.push(row.id);
      continue;
    }

    const { data: activeDupes, error: dupeErr } = await sb
      .from("job_queue")
      .select("id")
      .eq("job_type", "lesson_generate_content")
      .in("status", ["pending", "queued", "processing"])
      .filter("payload->>lesson_id", "eq", lessonId)
      .filter("payload->>step_key", "eq", stepKey)
      .neq("id", row.id)
      .limit(1);

    if (dupeErr) return json({ error: "DB_DUPE_CHECK_FAILED", details: dupeErr }, 500);
    if ((activeDupes?.length ?? 0) > 0) {
      skippedActiveDupe.push(row.id);
      continue;
    }

    if (dryRun) {
      cancelled.push(row.id);
      continue;
    }

    const { error: updErr } = await sb
      .from("job_queue")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: `${row.last_error ?? ""} | cancelled_by_admin_revive_transient_exhausted`.trim(),
        meta: {
          ...((row.meta as Record<string, unknown>) ?? {}),
          revived_at: new Date().toISOString(),
          revived_reason: "ops_revive_transient_exhausted",
        },
      })
      .eq("id", row.id);

    if (updErr) return json({ error: "DB_UPDATE_FAILED", details: updErr, job_id: row.id }, 500);
    cancelled.push(row.id);
  }

  return json({
    ok: true,
    window_hours: windowHours,
    dry_run: dryRun,
    exhausted_candidates: candidates.length,
    cancelled_count: cancelled.length,
    skipped_active_dupe_count: skippedActiveDupe.length,
    cancelled_ids: cancelled.slice(0, 100),
    skipped_ids: skippedActiveDupe.slice(0, 100),
  });
});
