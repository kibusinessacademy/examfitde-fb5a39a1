
-- =============================================================
-- 1) Canonical SSOT helper view: v_package_progress_ssot
--    Single source for done/functional/progress across all consumers
-- =============================================================
CREATE OR REPLACE VIEW public.v_package_progress_ssot AS
SELECT
  ps.package_id,
  count(*) FILTER (WHERE ps.status = 'done') AS steps_done,
  count(*) FILTER (WHERE ps.status <> 'skipped') AS steps_functional,
  count(*) AS steps_total_raw,
  count(*) FILTER (WHERE ps.status = 'skipped') AS steps_skipped,
  count(*) FILTER (WHERE ps.status = 'running') AS steps_running,
  count(*) FILTER (WHERE ps.status IN ('blocked','failed')) AS steps_stuck,
  count(*) FILTER (WHERE ps.status IN ('queued','enqueued')) AS steps_queued,
  CASE WHEN count(*) FILTER (WHERE ps.status <> 'skipped') > 0
    THEN round(count(*) FILTER (WHERE ps.status = 'done') * 100.0 
               / count(*) FILTER (WHERE ps.status <> 'skipped'))
    ELSE 0
  END::integer AS progress_pct
FROM package_steps ps
GROUP BY ps.package_id;

COMMENT ON VIEW public.v_package_progress_ssot IS 
'SSOT for step progress. All views/UI must derive done/total from here. Denominator excludes skipped steps to match recompute_package_progress().';

-- =============================================================
-- 2) Fix pipeline_deadlock_detection: use functional denominator
-- =============================================================
DROP VIEW IF EXISTS public.pipeline_deadlock_detection;
CREATE VIEW public.pipeline_deadlock_detection AS
SELECT ps.package_id,
   cp.title AS package_title,
   cp.status AS package_status,
   count(*) FILTER (WHERE ps.status <> 'skipped') AS total_steps,
   count(*) FILTER (WHERE ps.status IN ('blocked','failed')) AS stuck_steps,
   count(*) FILTER (WHERE ps.status = 'done') AS done_steps,
   count(*) FILTER (WHERE ps.status IN ('running','enqueued','queued')) AS active_steps,
   max(ps.updated_at) AS last_step_update,
   EXTRACT(epoch FROM now() - max(ps.updated_at)) / 60.0 AS no_progress_minutes,
   CASE
     WHEN count(*) FILTER (WHERE ps.status IN ('running','enqueued','queued','done')) = 0
          AND count(*) FILTER (WHERE ps.status IN ('blocked','failed')) > 0
       THEN 'full_deadlock'
     WHEN (EXTRACT(epoch FROM now() - max(ps.updated_at)) / 60.0) > 60 THEN 'stalled_60min'
     WHEN (EXTRACT(epoch FROM now() - max(ps.updated_at)) / 60.0) > 30 THEN 'stalled_30min'
     ELSE 'active'
   END AS deadlock_status
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE cp.status = 'building'
GROUP BY ps.package_id, cp.title, cp.status
HAVING count(*) FILTER (WHERE ps.status IN ('running','enqueued','queued')) = 0
   OR (EXTRACT(epoch FROM now() - max(ps.updated_at)) / 60.0) > 30
ORDER BY (EXTRACT(epoch FROM now() - max(ps.updated_at)) / 60.0) DESC NULLS LAST;
