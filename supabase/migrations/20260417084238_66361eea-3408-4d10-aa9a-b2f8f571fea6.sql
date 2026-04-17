-- Heal-Cockpit v8.3
-- Adds 'awaiting_pipeline' classification to drain noise from manual_review.
-- Trigger: release_block + no jobs + no repair attempts + fresh activity (<=24h) + no blocked_reason.
-- actionability_class = 'observe' (not bulk-actionable, no RPC change needed).
-- Precedence: hard_rebuild > guided_recovery > mark_content_gap > force_publish
--           > bulk_reconcile > awaiting_pipeline > monitor > manual_review

CREATE OR REPLACE VIEW public.v_admin_heal_cockpit AS
WITH job_open_by_type AS (
  SELECT job_queue.package_id, job_queue.job_type, count(*) AS cnt
  FROM job_queue
  WHERE job_queue.status = ANY (ARRAY['pending'::text, 'queued'::text, 'processing'::text, 'failed'::text])
    AND job_queue.package_id IS NOT NULL
  GROUP BY job_queue.package_id, job_queue.job_type
), job_agg AS (
  SELECT j.package_id,
    count(*) FILTER (WHERE j.status = ANY (ARRAY['pending'::text, 'queued'::text])) AS pending_jobs,
    count(*) FILTER (WHERE j.status = 'processing'::text) AS processing_jobs,
    count(*) FILTER (WHERE j.status = 'failed'::text AND j.updated_at > (now() - '24:00:00'::interval)) AS failed_jobs_24h,
    count(*) FILTER (WHERE (j.status = ANY (ARRAY['pending'::text, 'queued'::text, 'processing'::text])) AND j.job_type ~~ 'package_repair_%'::text) AS active_repair_jobs,
    count(*) FILTER (WHERE (j.status = ANY (ARRAY['pending'::text, 'queued'::text, 'processing'::text])) AND j.job_type = 'package_reconcile_artifacts'::text) AS active_reconcile_jobs,
    COALESCE(max(j.attempts) FILTER (WHERE j.job_type ~~ 'package_repair_%'::text AND j.created_at > (now() - '7 days'::interval)), 0) AS repair_attempts_proxy,
    max(j.updated_at) FILTER (WHERE j.status = 'processing'::text) AS last_processing_at,
    COALESCE((SELECT jsonb_object_agg(t.job_type, t.cnt)
              FROM job_open_by_type t WHERE t.package_id = j.package_id), '{}'::jsonb) AS open_jobs_by_type
  FROM job_queue j
  WHERE j.package_id IS NOT NULL
  GROUP BY j.package_id
), step_agg AS (
  SELECT ps.package_id,
    count(*) FILTER (WHERE ps.status = 'blocked'::step_status AND COALESCE(ps.meta ->> 'no_effect_repair'::text, 'false'::text) = 'true'::text
                     OR ps.attempts >= COALESCE(ps.max_attempts, 3) AND (ps.status = ANY (ARRAY['blocked'::step_status, 'failed'::step_status, 'timeout'::step_status]))) AS exhausted_steps,
    count(*) FILTER (WHERE ps.status = 'blocked'::step_status) AS blocked_steps,
    max(ps.updated_at) AS last_step_change
  FROM package_steps ps
  GROUP BY ps.package_id
), base AS (
  SELECT cp.id AS package_id,
    cp.title AS package_title,
    cp.curriculum_id,
    cp.status AS package_status,
    cp.is_published,
    cp.blocked_reason,
    cp.updated_at AS package_updated_at,
    rc.course_title,
    rc.release_class,
    rc.deficiency_codes,
    COALESCE(ja.pending_jobs, 0::bigint) AS pending_jobs,
    COALESCE(ja.processing_jobs, 0::bigint) AS processing_jobs,
    COALESCE(ja.failed_jobs_24h, 0::bigint) AS failed_jobs_24h,
    COALESCE(ja.active_repair_jobs, 0::bigint) AS active_repair_jobs,
    COALESCE(ja.active_reconcile_jobs, 0::bigint) AS active_reconcile_jobs,
    COALESCE(ja.repair_attempts_proxy, 0) AS repair_attempts_proxy,
    ja.last_processing_at,
    COALESCE(ja.open_jobs_by_type, '{}'::jsonb) AS open_jobs_by_type,
    COALESCE(sa.exhausted_steps, 0::bigint) AS exhausted_steps,
    COALESCE(sa.blocked_steps, 0::bigint) AS blocked_steps,
    sa.last_step_change
  FROM course_packages cp
    LEFT JOIN v_package_release_classification rc ON rc.package_id = cp.id
    LEFT JOIN job_agg ja ON ja.package_id = cp.id
    LEFT JOIN step_agg sa ON sa.package_id = cp.id
  WHERE cp.status IS NOT NULL
)
SELECT package_id, package_title, course_title, curriculum_id, package_status,
  is_published, blocked_reason, release_class, deficiency_codes,
  pending_jobs, processing_jobs, failed_jobs_24h, active_repair_jobs, active_reconcile_jobs,
  repair_attempts_proxy, exhausted_steps, blocked_steps,
  last_processing_at, last_step_change, package_updated_at, open_jobs_by_type,
  CASE
    WHEN (package_status = 'published'::text OR is_published = true) AND deficiency_codes IS NOT NULL AND array_length(deficiency_codes, 1) > 0 THEN 'hard_rebuild'::text
    WHEN blocked_reason = 'quality_no_progress_3x'::text OR exhausted_steps > 0 THEN 'guided_recovery'::text
    WHEN release_class = 'release_block'::text AND repair_attempts_proxy > 5 THEN 'mark_content_gap'::text
    WHEN release_class = 'release_ok'::text AND package_status <> 'published'::text AND COALESCE(is_published, false) = false AND COALESCE(array_length(deficiency_codes, 1), 0) = 0 AND blocked_reason IS NULL AND active_repair_jobs = 0 THEN 'force_publish'::text
    WHEN release_class = 'release_warn'::text AND active_repair_jobs = 0 AND active_reconcile_jobs = 0 THEN 'bulk_reconcile'::text
    -- v8.3: fresh release_block packages with no pipeline activity yet
    WHEN release_class = 'release_block'::text
         AND repair_attempts_proxy = 0
         AND pending_jobs = 0 AND processing_jobs = 0
         AND blocked_reason IS NULL
         AND COALESCE(last_step_change, package_updated_at) > (now() - '24:00:00'::interval)
      THEN 'awaiting_pipeline'::text
    WHEN processing_jobs > 0 AND last_processing_at > (now() - '00:20:00'::interval) OR pending_jobs > 0 AND package_updated_at > (now() - '00:30:00'::interval) THEN 'monitor'::text
    ELSE 'manual_review'::text
  END AS recommended_action,
  CASE
    WHEN (package_status = 'published'::text OR is_published = true) AND deficiency_codes IS NOT NULL AND array_length(deficiency_codes, 1) > 0 THEN 'confirm'::text
    WHEN blocked_reason = 'quality_no_progress_3x'::text OR exhausted_steps > 0 THEN 'modal'::text
    WHEN release_class = 'release_block'::text AND repair_attempts_proxy > 5 THEN 'confirm'::text
    WHEN release_class = 'release_ok'::text AND package_status <> 'published'::text AND COALESCE(is_published, false) = false AND blocked_reason IS NULL AND active_repair_jobs = 0 THEN 'auto'::text
    WHEN release_class = 'release_warn'::text AND active_repair_jobs = 0 AND active_reconcile_jobs = 0 THEN 'auto'::text
    ELSE 'observe'::text
  END AS actionability_class,
  array_remove(ARRAY[
    CASE WHEN blocked_reason IS NOT NULL THEN 'blocked_reason='::text || blocked_reason ELSE NULL END,
    CASE WHEN exhausted_steps > 0 THEN 'exhausted_steps='::text || exhausted_steps::text ELSE NULL END,
    CASE WHEN release_class IS NOT NULL THEN 'release_class='::text || release_class ELSE NULL END,
    CASE WHEN repair_attempts_proxy > 5 THEN 'repair_attempts_proxy='::text || repair_attempts_proxy::text ELSE NULL END,
    CASE WHEN deficiency_codes IS NOT NULL AND array_length(deficiency_codes, 1) > 0 THEN 'deficiencies='::text || array_length(deficiency_codes, 1)::text ELSE NULL END,
    CASE WHEN active_repair_jobs > 0 THEN 'active_repair_jobs='::text || active_repair_jobs::text ELSE NULL END,
    CASE WHEN active_reconcile_jobs > 0 THEN 'active_reconcile_jobs='::text || active_reconcile_jobs::text ELSE NULL END,
    CASE WHEN failed_jobs_24h > 3 THEN 'failed_jobs_24h='::text || failed_jobs_24h::text ELSE NULL END,
    CASE WHEN package_status = 'published'::text THEN 'is_published=true'::text ELSE NULL END,
    -- v8.3: explicit reason marker for awaiting_pipeline
    CASE
      WHEN release_class = 'release_block'::text
           AND repair_attempts_proxy = 0
           AND pending_jobs = 0 AND processing_jobs = 0
           AND blocked_reason IS NULL
           AND COALESCE(last_step_change, package_updated_at) > (now() - '24:00:00'::interval)
        THEN 'awaiting_pipeline_start=true'::text
      ELSE NULL
    END
  ], NULL::text) AS recommended_action_reasons,
  LEAST(100, GREATEST(0,
    CASE
      WHEN (package_status = 'published'::text OR is_published = true) AND deficiency_codes IS NOT NULL AND array_length(deficiency_codes, 1) > 0 THEN 95
      WHEN blocked_reason = 'quality_no_progress_3x'::text OR exhausted_steps > 0 THEN 90
      WHEN release_class = 'release_block'::text AND repair_attempts_proxy > 5 THEN 85
      WHEN release_class = 'release_ok'::text AND package_status <> 'published'::text THEN 70
      WHEN release_class = 'release_warn'::text THEN 55
      -- v8.3: low urgency for awaiting_pipeline (operators don't need to act)
      WHEN release_class = 'release_block'::text
           AND repair_attempts_proxy = 0
           AND pending_jobs = 0 AND processing_jobs = 0
           AND blocked_reason IS NULL
           AND COALESCE(last_step_change, package_updated_at) > (now() - '24:00:00'::interval) THEN 15
      WHEN processing_jobs > 0 OR pending_jobs > 0 THEN 20
      ELSE 50
    END +
    CASE WHEN blocked_reason IS NOT NULL THEN 10 ELSE 0 END +
    CASE WHEN exhausted_steps > 0 THEN 8 ELSE 0 END +
    CASE WHEN failed_jobs_24h > 3 THEN 6 ELSE 0 END +
    CASE WHEN release_class = 'release_block'::text THEN 5 ELSE 0 END -
    CASE WHEN processing_jobs > 0 AND last_processing_at > (now() - '00:10:00'::interval) THEN 10 ELSE 0 END
  )) AS urgency_score
FROM base b;