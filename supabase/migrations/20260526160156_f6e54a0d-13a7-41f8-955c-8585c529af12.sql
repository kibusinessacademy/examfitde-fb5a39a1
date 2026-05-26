-- P74b.1: Härtung v_queued_tail_without_job_v2
-- Eliminiert Silent-Drops durch Upstream-DAG-Check.
-- Pakete erscheinen nur, wenn KEIN anderer package_step (außer der gewählte Tail-Step)
-- in Status queued/processing/blocked steht.

CREATE OR REPLACE VIEW public.v_queued_tail_without_job_v2 AS
WITH tail_candidates AS (
  SELECT
    cp.id AS package_id,
    cp.package_key,
    cp.curriculum_id,
    cp.track,
    cp.status AS package_status,
    cp.feature_flags,
    (
      SELECT count(*)
      FROM exam_questions eq
      WHERE eq.package_id = cp.id AND eq.status = 'approved'::question_status
    ) AS approved_q,
    fn_is_bronze_locked(cp.id) AS bronze_locked,
    (
      SELECT s.step_key
      FROM (
        SELECT ps.step_key,
          CASE ps.step_key
            WHEN 'run_integrity_check' THEN 1
            WHEN 'quality_council'     THEN 2
            WHEN 'auto_publish'        THEN 3
          END AS ord
        FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
          AND ps.status::text IN ('queued','blocked')
      ) s
      ORDER BY s.ord
      LIMIT 1
    ) AS next_tail_step
  FROM course_packages cp
  WHERE cp.status IN ('building','done')
    AND COALESCE(cp.archived, false) = false
)
SELECT
  tc.package_id,
  tc.package_key,
  tc.curriculum_id,
  tc.track,
  tc.package_status,
  tc.approved_q,
  tc.bronze_locked,
  COALESCE(((tc.feature_flags -> 'bronze') ->> 'manual_bypass')::boolean, false) AS bronze_manual_bypass,
  tc.next_tail_step
FROM tail_candidates tc
WHERE tc.approved_q >= 50
  AND tc.bronze_locked = false
  AND tc.next_tail_step IS NOT NULL
  -- Kein aktiver job_queue-Job auf dem Paket
  AND NOT EXISTS (
    SELECT 1 FROM job_queue j
    WHERE j.package_id = tc.package_id
      AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending')
  )
  -- HÄRTUNG v2.1: Keine vorgelagerten / parallelen Schritte aktiv
  -- (außer dem gewählten Tail-Step selbst)
  AND NOT EXISTS (
    SELECT 1 FROM package_steps ps2
    WHERE ps2.package_id = tc.package_id
      AND ps2.status::text IN ('queued','processing','blocked')
      AND ps2.step_key <> tc.next_tail_step
  );

REVOKE ALL ON public.v_queued_tail_without_job_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_queued_tail_without_job_v2 TO service_role;

COMMENT ON VIEW public.v_queued_tail_without_job_v2 IS
  'P74b.1 (2026-05-26): Härtung — listet nur Pakete, deren Tail-Step (integrity/council/auto_publish) wirklich enqueue-fähig ist: ≥50 approved, bronze_locked=false, kein aktiver job_queue-Job, UND kein anderer package_step in queued/processing/blocked. Eliminiert die 4 Silent-Drops aus dem v2-Live-Run (2026-05-26).';