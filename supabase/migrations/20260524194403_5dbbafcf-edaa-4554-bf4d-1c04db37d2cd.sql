
DROP VIEW IF EXISTS public.v_stale_lock_loop_packages CASCADE;
CREATE VIEW public.v_stale_lock_loop_packages AS
WITH recent_fail AS (
  SELECT
    jq.id              AS job_id,
    jq.job_type,
    jq.package_id,
    jq.attempts,
    jq.max_attempts,
    jq.locked_by       AS lock_owner,
    jq.locked_at,
    jq.last_heartbeat_at,
    jq.last_error_code,
    LEFT(COALESCE(jq.last_error, jq.error::text, ''), 400) AS last_error,
    jq.updated_at,
    EXTRACT(EPOCH FROM (now() - jq.updated_at))/60.0 AS age_minutes,
    COALESCE((jq.meta->>'recovery_cycles')::int, 0)  AS recovery_cycles
  FROM public.job_queue jq
  WHERE jq.status = 'failed'
    AND jq.last_error_code IN ('STALE_LOCK_LOOP_HARD_KILL','STALE_PROCESSING_REAPED','PRE_HEARTBEAT_KILL')
    AND jq.updated_at > now() - interval '24 hours'
)
SELECT
  rf.*,
  cp.package_key,
  cp.title  AS package_title,
  cp.status AS package_status,
  (SELECT COUNT(*) FROM recent_fail rf2
    WHERE rf2.package_id = rf.package_id
      AND rf2.job_type   = rf.job_type
      AND rf2.updated_at > now() - interval '1 hour')   AS loop_count_1h,
  (SELECT COUNT(*) FROM recent_fail rf3
    WHERE rf3.package_id = rf.package_id
      AND rf3.job_type   = rf.job_type)                  AS loop_count_24h
FROM recent_fail rf
LEFT JOIN public.course_packages cp ON cp.id = rf.package_id;

REVOKE ALL ON public.v_stale_lock_loop_packages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_stale_lock_loop_packages TO service_role;


DROP VIEW IF EXISTS public.v_integrity_quality_failures CASCADE;
CREATE VIEW public.v_integrity_quality_failures AS
WITH base AS (
  SELECT
    jq.id          AS job_id,
    jq.package_id,
    jq.attempts,
    jq.max_attempts,
    jq.last_error_code,
    LEFT(COALESCE(jq.last_error, jq.error::text, ''), 400) AS last_error,
    jq.updated_at
  FROM public.job_queue jq
  WHERE jq.job_type = 'package_run_integrity_check'
    AND jq.status   = 'failed'
    AND jq.last_error_code = 'QUALITY_THRESHOLD_NOT_MET'
    AND jq.updated_at > now() - interval '24 hours'
),
quality AS (
  SELECT DISTINCT ON (pqr.package_id)
    pqr.package_id,
    pqr.score::numeric         AS quality_score,
    pqr.status                 AS quality_report_status,
    pqr.rules_passed,
    pqr.rules_failed,
    pqr.rules_warned,
    pqr.created_at             AS quality_reported_at
  FROM public.package_quality_reports pqr
  ORDER BY pqr.package_id, pqr.created_at DESC
),
council AS (
  SELECT
    pqs.package_id,
    pqs.score::numeric AS council_score,
    pqs.badge          AS bronze_state,
    pqs.updated_at     AS council_updated_at
  FROM public.package_quality_scores pqs
),
approved_q AS (
  SELECT package_id, COUNT(*)::int AS approved_question_count
  FROM public.exam_questions
  WHERE status = 'approved'
  GROUP BY 1
)
SELECT
  b.job_id,
  b.package_id,
  cp.package_key,
  cp.title  AS package_title,
  cp.status AS package_status,
  b.attempts,
  b.last_error_code,
  b.last_error,
  b.updated_at,
  q.quality_score,
  q.quality_report_status,
  q.rules_passed,
  q.rules_failed,
  q.rules_warned,
  c.council_score,
  c.bronze_state,
  COALESCE(a.approved_question_count, 0) AS approved_question_count,
  CASE
    WHEN COALESCE(a.approved_question_count, 0) < 50 THEN 'exam_pool_underbuilt'
    WHEN q.quality_score IS NULL                     THEN 'no_quality_report'
    WHEN c.bronze_state = 'bronze'                   THEN 'bronze_locked_review'
    WHEN q.quality_score < 70                        THEN 'genuine_quality_low'
    ELSE 'review_required'
  END AS failed_gate,
  CASE
    WHEN COALESCE(a.approved_question_count, 0) < 50 THEN 'fix_exam_pool_first'
    WHEN c.bronze_state = 'bronze'                   THEN 'bronze_targeted_repair'
    WHEN q.quality_score IS NOT NULL AND q.quality_score < 70 THEN 'package_repair_quality_targeted'
    ELSE 'manual_review'
  END AS recommended_repair_job
FROM base b
LEFT JOIN public.course_packages cp ON cp.id = b.package_id
LEFT JOIN quality   q ON q.package_id = b.package_id
LEFT JOIN council   c ON c.package_id = b.package_id
LEFT JOIN approved_q a ON a.package_id = b.package_id;

REVOKE ALL ON public.v_integrity_quality_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_integrity_quality_failures TO service_role;


DROP VIEW IF EXISTS public.v_exam_pool_producer_failures CASCADE;
CREATE VIEW public.v_exam_pool_producer_failures AS
WITH base AS (
  SELECT
    jq.id           AS job_id,
    jq.package_id,
    jq.attempts,
    jq.max_attempts,
    jq.last_error_code,
    LEFT(COALESCE(jq.last_error, jq.error::text, ''), 600) AS last_error,
    jq.updated_at
  FROM public.job_queue jq
  WHERE jq.job_type = 'package_validate_exam_pool'
    AND jq.status   = 'failed'
    AND jq.updated_at > now() - interval '24 hours'
),
approved_q AS (
  SELECT package_id, COUNT(*)::int AS approved_question_count
  FROM public.exam_questions
  WHERE status = 'approved'
  GROUP BY 1
),
producer_active AS (
  SELECT package_id,
         COUNT(*) FILTER (WHERE status IN ('queued','pending','processing','running'))::int AS active_producer_jobs,
         COUNT(*) FILTER (WHERE status = 'failed')::int                                      AS failed_producer_jobs
  FROM public.job_queue
  WHERE job_type IN ('pool_fill_bloom_gaps','pool_fill_lf_gaps','package_generate_exam_pool',
                     'package_repair_exam_pool_quality','repair_exam_pool_lf_coverage')
    AND updated_at > now() - interval '6 hours'
  GROUP BY 1
)
SELECT
  b.job_id,
  b.package_id,
  cp.package_key,
  cp.title  AS package_title,
  cp.status AS package_status,
  b.attempts,
  b.last_error_code,
  b.last_error,
  b.updated_at,
  COALESCE(a.approved_question_count, 0) AS approved_question_count,
  50                                     AS required_min_count,
  (b.last_error ILIKE '%Artifact missing: exam_questions%') AS artifact_missing_exam_questions,
  (b.last_error ILIKE '%MAX_ATTEMPTS%')                     AS hit_max_attempts,
  COALESCE(p.active_producer_jobs, 0) AS active_producer_jobs,
  COALESCE(p.failed_producer_jobs, 0) AS failed_producer_jobs,
  CASE
    WHEN COALESCE(p.active_producer_jobs, 0) > 0                        THEN 'wait_active_producer'
    WHEN b.last_error ILIKE '%Artifact missing: exam_questions%'        THEN 'enqueue_generate_exam_pool'
    WHEN COALESCE(a.approved_question_count, 0) < 50
         AND COALESCE(p.failed_producer_jobs, 0) >= 3                   THEN 'investigate_producer_failure'
    WHEN COALESCE(a.approved_question_count, 0) < 50                    THEN 'enqueue_pool_fill_bloom_gaps'
    WHEN b.last_error_code = 'REQUEUE_LOOP_KILLED'                      THEN 'manual_review'
    ELSE 'manual_review'
  END AS recommended_repair
FROM base b
LEFT JOIN public.course_packages cp ON cp.id = b.package_id
LEFT JOIN approved_q a ON a.package_id = b.package_id
LEFT JOIN producer_active p ON p.package_id = b.package_id;

REVOKE ALL ON public.v_exam_pool_producer_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_exam_pool_producer_failures TO service_role;


CREATE OR REPLACE FUNCTION public.admin_diagnose_auto_publish_lock_loops(p_limit int DEFAULT 50)
RETURNS TABLE (
  package_id        uuid,
  package_key       text,
  package_title     text,
  job_type          text,
  loop_count_1h     bigint,
  loop_count_24h    bigint,
  attempts          int,
  age_minutes       numeric,
  last_error_code   text,
  last_error        text,
  recommended_action text,
  reason_codes      text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    v.package_id, v.package_key, v.package_title, v.job_type,
    v.loop_count_1h, v.loop_count_24h, v.attempts,
    v.age_minutes::numeric, v.last_error_code, v.last_error,
    CASE
      WHEN public.has_role(auth.uid(),'admin') = false THEN 'forbidden'
      WHEN v.loop_count_1h >= 5 AND v.attempts >= 3 THEN 'release_stale_lock'
      WHEN v.loop_count_24h >= 8                     THEN 'cancel_duplicate_jobs'
      WHEN v.loop_count_1h  >= 2                     THEN 'manual_review'
      ELSE 'noop'
    END AS recommended_action,
    ARRAY_REMOVE(ARRAY[
      v.last_error_code,
      CASE WHEN v.recovery_cycles >= 5 THEN 'recovery_cycles_exceeded' END,
      CASE WHEN v.attempts >= v.max_attempts THEN 'attempts_exhausted' END,
      CASE WHEN v.age_minutes > 60 THEN 'stale_over_1h' END
    ], NULL) AS reason_codes
  FROM public.v_stale_lock_loop_packages v
  WHERE public.has_role(auth.uid(),'admin') = true
    AND v.job_type = 'package_auto_publish'
  ORDER BY v.loop_count_1h DESC, v.updated_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;
REVOKE ALL ON FUNCTION public.admin_diagnose_auto_publish_lock_loops(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_diagnose_auto_publish_lock_loops(int) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.admin_diagnose_integrity_quality_failures(p_limit int DEFAULT 50)
RETURNS SETOF public.v_integrity_quality_failures
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_integrity_quality_failures v
  WHERE public.has_role(auth.uid(),'admin') = true
  ORDER BY v.updated_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;
REVOKE ALL ON FUNCTION public.admin_diagnose_integrity_quality_failures(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_diagnose_integrity_quality_failures(int) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.admin_diagnose_exam_pool_producer_failures(p_limit int DEFAULT 50)
RETURNS SETOF public.v_exam_pool_producer_failures
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.v_exam_pool_producer_failures v
  WHERE public.has_role(auth.uid(),'admin') = true
  ORDER BY v.updated_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;
REVOKE ALL ON FUNCTION public.admin_diagnose_exam_pool_producer_failures(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_diagnose_exam_pool_producer_failures(int) TO authenticated, service_role;
