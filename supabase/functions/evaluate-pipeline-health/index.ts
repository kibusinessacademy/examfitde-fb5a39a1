// PIPELINE.HEALTH.OS.1 — Admin-only pipeline health projector (read-only).
// Reads existing SSOT views, runs Pure projector, returns JSON. No writes.
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";
import {
  project,
  type JobHealthRow,
  type StuckRow,
  type DeadLetterRow,
  type PendingAgeRow,
} from "../_shared/pipelineHealth/index.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  const [kpisRes, stuckRes, dlqRes, pendingRes] = await Promise.all([
    sb.from("job_health_kpis").select("job_type,pending,processing,completed,failed,cancelled,blocked,total,avg_fail_attempts,last_activity"),
    sb.from("job_processing_age").select("id,worker_pool,job_type,running_for,attempts,last_error").limit(50),
    sb.from("dead_letter_jobs").select("job_type,error_category,error_code,created_at").is("resolved_at", null).limit(500),
    sb.from("job_artifact_blockers_top").select("job_type,worker_pool,pending_jobs,blocked_mode_jobs,oldest_updated_at").limit(100),
  ]);

  if (kpisRes.error) return json({ error: "kpis_failed", detail: kpisRes.error.message }, 500);

  // running_for is interval; supabase-js returns it as object {hours,minutes,seconds} or string. Normalize.
  const stuck: StuckRow[] = (stuckRes.data ?? []).map((r: any) => {
    let secs = 0;
    const rf = r.running_for;
    if (typeof rf === "string") {
      // "01:23:45.123" or "1 day 02:03:04"
      const m = rf.match(/(?:(\d+)\s*day[s]?\s*)?(\d+):(\d+):(\d+)/);
      if (m) secs = (+m[1] || 0) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]);
    } else if (rf && typeof rf === "object") {
      secs = (rf.days ?? 0) * 86400 + (rf.hours ?? 0) * 3600 + (rf.minutes ?? 0) * 60 + (rf.seconds ?? 0);
    }
    return {
      id: r.id, worker_pool: r.worker_pool, job_type: r.job_type,
      running_for_seconds: secs, attempts: r.attempts ?? 0, last_error: r.last_error,
    };
  });

  const projection = project({
    kpis: (kpisRes.data ?? []) as JobHealthRow[],
    stuck,
    dlq: (dlqRes.data ?? []) as DeadLetterRow[],
    pending_age: (pendingRes.data ?? []) as PendingAgeRow[],
    now_iso: new Date().toISOString(),
  });

  return json({ ok: true, projection });
});
