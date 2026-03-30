
-- Drop old view first (column name conflict)
DROP VIEW IF EXISTS public.ops_validate_exam_pool_progress;

-- Drop old function to ensure clean state
DROP FUNCTION IF EXISTS public.fn_classify_validate_guard(uuid);

-- 1) Snapshot table (IF NOT EXISTS = safe re-run)
CREATE TABLE IF NOT EXISTS public.exam_pool_validation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  curriculum_id uuid,
  job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_count int NOT NULL DEFAULT 0,
  review_count int NOT NULL DEFAULT 0,
  draft_count int NOT NULL DEFAULT 0,
  rejected_count int NOT NULL DEFAULT 0,
  unresolved_quality_flags int NOT NULL DEFAULT 0,
  missing_lf_coverage int NOT NULL DEFAULT 0,
  missing_competency_coverage int NOT NULL DEFAULT 0,
  missing_trap_metadata int NOT NULL DEFAULT 0,
  missing_bloom_metadata int NOT NULL DEFAULT 0,
  repairable_issue_count int NOT NULL DEFAULT 0,
  guard_state text,
  reason_code text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_exam_pool_validation_snapshots_package_created
  ON public.exam_pool_validation_snapshots(package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_pool_validation_snapshots_curriculum
  ON public.exam_pool_validation_snapshots(curriculum_id);

-- 2) Guard classifier
CREATE OR REPLACE FUNCTION public.fn_classify_validate_guard(
  p_package_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curr record;
  v_prev record;
  v_step_meta jsonb := '{}'::jsonb;
  v_step_attempts int := 0;
  v_active_validate int := 0;
  v_active_repair int := 0;
  v_validate_24h int := 0;
  v_repair_24h int := 0;
  v_has_lease boolean := false;
  v_grace_until timestamptz := null;
  v_consecutive_no_progress int := 0;
  v_progress boolean := false;
  v_delta_approved int := 0;
  v_delta_review int := 0;
  v_delta_unresolved int := 0;
  v_delta_lf int := 0;
  v_delta_competency int := 0;
BEGIN
  SELECT * INTO v_curr
  FROM public.exam_pool_validation_snapshots
  WHERE package_id = p_package_id
  ORDER BY created_at DESC, id DESC LIMIT 1;

  SELECT * INTO v_prev
  FROM public.exam_pool_validation_snapshots
  WHERE package_id = p_package_id
  ORDER BY created_at DESC, id DESC OFFSET 1 LIMIT 1;

  SELECT COALESCE(meta, '{}'::jsonb), COALESCE(attempts, 0)
  INTO v_step_meta, v_step_attempts
  FROM public.package_steps
  WHERE package_id = p_package_id AND step_key = 'validate_exam_pool'
  LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE job_type = 'package_validate_exam_pool' AND status IN ('pending','queued','processing','running','batch_pending')),
    COUNT(*) FILTER (WHERE job_type = 'package_repair_exam_pool_quality' AND status IN ('pending','queued','processing','running','batch_pending')),
    COUNT(*) FILTER (WHERE job_type = 'package_validate_exam_pool' AND created_at > now() - interval '24 hours'),
    COUNT(*) FILTER (WHERE job_type = 'package_repair_exam_pool_quality' AND created_at > now() - interval '24 hours')
  INTO v_active_validate, v_active_repair, v_validate_24h, v_repair_24h
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND job_type IN ('package_validate_exam_pool', 'package_repair_exam_pool_quality');

  SELECT EXISTS (
    SELECT 1 FROM public.package_leases
    WHERE package_id = p_package_id AND lease_until > now()
  ) INTO v_has_lease;

  v_grace_until := CASE
    WHEN COALESCE(v_step_meta->>'grace_until', '') <> ''
    THEN (v_step_meta->>'grace_until')::timestamptz
    ELSE NULL
  END;
  v_consecutive_no_progress := COALESCE((v_step_meta->>'consecutive_no_progress')::int, 0);

  IF v_curr IS NOT NULL AND v_prev IS NOT NULL THEN
    v_delta_approved := COALESCE(v_curr.approved_count,0) - COALESCE(v_prev.approved_count,0);
    v_delta_review := COALESCE(v_curr.review_count,0) - COALESCE(v_prev.review_count,0);
    v_delta_unresolved := COALESCE(v_curr.unresolved_quality_flags,0) - COALESCE(v_prev.unresolved_quality_flags,0);
    v_delta_lf := COALESCE(v_curr.missing_lf_coverage,0) - COALESCE(v_prev.missing_lf_coverage,0);
    v_delta_competency := COALESCE(v_curr.missing_competency_coverage,0) - COALESCE(v_prev.missing_competency_coverage,0);
  END IF;

  v_progress := (v_delta_approved > 0) OR (v_delta_review < 0) OR (v_delta_unresolved < 0) OR (v_delta_lf < 0) OR (v_delta_competency < 0);

  IF v_progress THEN
    RETURN jsonb_build_object('guard_state','healthy','reason_code',null,'action','allow',
      'delta_approved',v_delta_approved,'delta_review',v_delta_review,
      'delta_unresolved_flags',v_delta_unresolved,'delta_missing_lf_coverage',v_delta_lf,
      'delta_missing_competency_coverage',v_delta_competency);
  END IF;

  IF v_grace_until IS NOT NULL AND v_grace_until > now() THEN
    RETURN jsonb_build_object('guard_state','recovering','reason_code','RECENT_HEAL_GRACE_ACTIVE','action','allow_wait','grace_until',v_grace_until);
  END IF;

  IF v_active_validate > 0 OR v_active_repair > 0 OR v_has_lease THEN
    RETURN jsonb_build_object('guard_state','recovering','reason_code','REPAIR_RUNNING_AWAITING_DELTA','action','allow_wait',
      'active_validate',v_active_validate,'active_repair',v_active_repair,'has_active_lease',v_has_lease);
  END IF;

  IF v_validate_24h >= 6 AND v_consecutive_no_progress >= 2 AND v_repair_24h = 0 THEN
    RETURN jsonb_build_object('guard_state','soft_stalled','reason_code','VALIDATE_EXAM_POOL_SOFT_STALL','action','enqueue_repair',
      'validate_attempts_24h',v_validate_24h,'consecutive_no_progress',v_consecutive_no_progress);
  END IF;

  IF v_validate_24h >= 12 AND v_consecutive_no_progress >= 4 AND v_repair_24h >= 2
     AND v_active_validate = 0 AND v_active_repair = 0 AND NOT v_has_lease
     AND (v_grace_until IS NULL OR v_grace_until <= now()) THEN
    RETURN jsonb_build_object('guard_state','hard_stalled','reason_code','VALIDATE_EXAM_POOL_TRUE_STALL','action','block',
      'validate_attempts_24h',v_validate_24h,'repair_attempts_24h',v_repair_24h,'consecutive_no_progress',v_consecutive_no_progress);
  END IF;

  IF v_consecutive_no_progress >= 2 THEN
    RETURN jsonb_build_object('guard_state','soft_stalled','reason_code','NO_PROGRESS_AFTER_REPAIR','action','requeue_validate',
      'consecutive_no_progress',v_consecutive_no_progress);
  END IF;

  RETURN jsonb_build_object('guard_state','healthy','reason_code',null,'action','allow');
END;
$$;

-- 3) View
CREATE OR REPLACE VIEW public.ops_validate_exam_pool_progress AS
WITH ranked AS (
  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.package_id ORDER BY s.created_at DESC, s.id DESC) AS rn
  FROM public.exam_pool_validation_snapshots s
),
curr AS (SELECT * FROM ranked WHERE rn = 1),
prev AS (SELECT * FROM ranked WHERE rn = 2),
step_info AS (
  SELECT ps.package_id, ps.status AS step_status, COALESCE(ps.attempts,0) AS attempts,
         ps.last_error, COALESCE(ps.meta,'{}'::jsonb) AS meta
  FROM public.package_steps ps WHERE ps.step_key = 'validate_exam_pool'
),
active_jobs AS (
  SELECT jq.package_id,
    COUNT(*) FILTER (WHERE jq.job_type='package_validate_exam_pool' AND jq.status IN ('pending','queued','processing','running','batch_pending')) AS active_validate_jobs,
    COUNT(*) FILTER (WHERE jq.job_type='package_repair_exam_pool_quality' AND jq.status IN ('pending','queued','processing','running','batch_pending')) AS active_repair_jobs,
    COUNT(*) FILTER (WHERE jq.job_type='package_validate_exam_pool' AND jq.created_at > now()-interval '24 hours') AS validate_attempts_24h,
    COUNT(*) FILTER (WHERE jq.job_type='package_repair_exam_pool_quality' AND jq.created_at > now()-interval '24 hours') AS repair_attempts_24h
  FROM public.job_queue jq
  WHERE jq.job_type IN ('package_validate_exam_pool','package_repair_exam_pool_quality')
  GROUP BY jq.package_id
),
lease_info AS (
  SELECT pl.package_id, true AS has_active_lease
  FROM public.package_leases pl WHERE pl.lease_until > now()
)
SELECT
  cp.id AS package_id, cp.title, cp.status AS package_status,
  curr.approved_count, curr.review_count, curr.draft_count, curr.rejected_count,
  curr.unresolved_quality_flags, curr.missing_lf_coverage, curr.missing_competency_coverage,
  curr.missing_trap_metadata, curr.missing_bloom_metadata, curr.repairable_issue_count,
  curr.guard_state, curr.reason_code, curr.created_at AS last_validate_at,
  COALESCE(curr.approved_count - prev.approved_count, 0) AS delta_approved,
  COALESCE(curr.review_count - prev.review_count, 0) AS delta_review,
  COALESCE(curr.unresolved_quality_flags - prev.unresolved_quality_flags, 0) AS delta_unresolved_flags,
  COALESCE(curr.missing_lf_coverage - prev.missing_lf_coverage, 0) AS delta_missing_lf_coverage,
  COALESCE(curr.missing_competency_coverage - prev.missing_competency_coverage, 0) AS delta_missing_competency_coverage,
  si.step_status, si.attempts AS step_attempts, si.last_error,
  COALESCE(aj.active_validate_jobs,0) AS active_validate_jobs,
  COALESCE(aj.active_repair_jobs,0) AS active_repair_jobs,
  COALESCE(aj.validate_attempts_24h,0) AS validate_attempts_24h,
  COALESCE(aj.repair_attempts_24h,0) AS repair_attempts_24h,
  COALESCE(li.has_active_lease, false) AS has_active_lease,
  CASE WHEN COALESCE(si.meta->>'grace_until','') <> '' AND (si.meta->>'grace_until')::timestamptz > now()
       THEN (si.meta->>'grace_until')::timestamptz ELSE NULL END AS grace_until,
  CASE WHEN COALESCE(si.meta->>'last_repair_completed_at','') <> ''
       THEN (si.meta->>'last_repair_completed_at')::timestamptz ELSE NULL END AS last_repair_at,
  COALESCE((si.meta->>'consecutive_no_progress')::int, 0) AS consecutive_no_progress,
  CASE
    WHEN curr.guard_state = 'hard_stalled' THEN 'manual_review'
    WHEN curr.guard_state = 'soft_stalled' AND COALESCE(aj.active_repair_jobs,0) = 0 THEN 'enqueue_repair'
    WHEN curr.guard_state = 'recovering' THEN 'await_grace'
    ELSE 'none'
  END AS recommended_action
FROM public.course_packages cp
LEFT JOIN curr ON curr.package_id = cp.id
LEFT JOIN prev ON prev.package_id = cp.id
LEFT JOIN step_info si ON si.package_id = cp.id
LEFT JOIN active_jobs aj ON aj.package_id = cp.id
LEFT JOIN lease_info li ON li.package_id = cp.id
WHERE cp.status IN ('building','blocked','quality_gate_failed')
  AND EXISTS (
    SELECT 1 FROM public.package_steps ps2
    WHERE ps2.package_id = cp.id AND ps2.step_key = 'validate_exam_pool'
  );

-- 4) Grants
REVOKE SELECT ON public.ops_validate_exam_pool_progress FROM anon, authenticated;
