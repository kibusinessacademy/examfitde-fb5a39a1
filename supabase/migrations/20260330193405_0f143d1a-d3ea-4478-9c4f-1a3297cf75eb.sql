
-- All-in-one: table + view + function for validate_exam_pool guard system

-- 1. Snapshot table
CREATE TABLE public.exam_pool_validation_snapshots (
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
  guard_state text NOT NULL DEFAULT 'healthy',
  reason_code text
);

CREATE INDEX idx_epvs_pkg_created ON public.exam_pool_validation_snapshots(package_id, created_at DESC);
ALTER TABLE public.exam_pool_validation_snapshots ENABLE ROW LEVEL SECURITY;

-- 2. Forensic view
CREATE OR REPLACE VIEW public.ops_validate_exam_pool_progress AS
WITH latest_two AS (
  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.package_id ORDER BY s.created_at DESC) AS rn
  FROM public.exam_pool_validation_snapshots s
),
curr AS (SELECT * FROM latest_two WHERE rn = 1),
prev AS (SELECT * FROM latest_two WHERE rn = 2),
step_info AS (
  SELECT ps.package_id, ps.status AS step_status, ps.attempts, ps.meta, ps.last_error
  FROM public.package_steps ps WHERE ps.step_key = 'validate_exam_pool'
),
active_jobs AS (
  SELECT jq.package_id,
    COUNT(*) FILTER (WHERE jq.job_type = 'package_validate_exam_pool' AND jq.status IN ('pending','processing')) AS active_validate_jobs,
    COUNT(*) FILTER (WHERE jq.job_type = 'package_repair_exam_pool_quality' AND jq.status IN ('pending','processing')) AS active_repair_jobs,
    COUNT(*) FILTER (WHERE jq.job_type = 'package_validate_exam_pool' AND jq.created_at > now() - interval '24 hours') AS validate_attempts_24h,
    COUNT(*) FILTER (WHERE jq.job_type = 'package_repair_exam_pool_quality' AND jq.created_at > now() - interval '24 hours') AS repair_attempts_24h
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
  curr.approved_count, curr.review_count, curr.draft_count,
  curr.unresolved_quality_flags, curr.missing_lf_coverage, curr.missing_competency_coverage,
  curr.guard_state, curr.reason_code, curr.created_at AS last_validate_at,
  COALESCE(curr.approved_count - prev.approved_count, 0) AS delta_approved,
  COALESCE(curr.review_count - prev.review_count, 0) AS delta_review,
  COALESCE(curr.unresolved_quality_flags - prev.unresolved_quality_flags, 0) AS delta_unresolved_flags,
  COALESCE(curr.missing_lf_coverage - prev.missing_lf_coverage, 0) AS delta_missing_lf_coverage,
  COALESCE(curr.missing_competency_coverage - prev.missing_competency_coverage, 0) AS delta_missing_competency_coverage,
  si.step_status, si.attempts AS step_attempts, si.last_error,
  COALESCE(aj.active_validate_jobs, 0) AS active_validate_jobs,
  COALESCE(aj.active_repair_jobs, 0) AS active_repair_jobs,
  COALESCE(aj.validate_attempts_24h, 0) AS validate_attempts_24h,
  COALESCE(aj.repair_attempts_24h, 0) AS repair_attempts_24h,
  COALESCE(li.has_active_lease, false) AS has_active_lease,
  CASE WHEN (si.meta->>'grace_until') IS NOT NULL AND (si.meta->>'grace_until')::timestamptz > now()
       THEN (si.meta->>'grace_until')::timestamptz END AS grace_until,
  (si.meta->>'last_repair_completed_at')::timestamptz AS last_repair_at,
  COALESCE((si.meta->>'consecutive_no_progress')::int, 0) AS consecutive_no_progress,
  CASE
    WHEN curr.guard_state = 'hard_stalled' THEN 'manual_review'
    WHEN curr.guard_state = 'soft_stalled' AND COALESCE(aj.active_repair_jobs, 0) = 0 THEN 'enqueue_repair'
    WHEN curr.guard_state = 'recovering' THEN 'await_grace'
    ELSE 'none'
  END AS recommended_action
FROM public.course_packages cp
LEFT JOIN curr ON curr.package_id = cp.id
LEFT JOIN prev ON prev.package_id = cp.id
LEFT JOIN step_info si ON si.package_id = cp.id
LEFT JOIN active_jobs aj ON aj.package_id = cp.id
LEFT JOIN lease_info li ON li.package_id = cp.id
WHERE cp.status IN ('building', 'blocked', 'quality_gate_failed')
  AND EXISTS (SELECT 1 FROM public.package_steps ps2 WHERE ps2.package_id = cp.id AND ps2.step_key = 'validate_exam_pool');

REVOKE SELECT ON public.ops_validate_exam_pool_progress FROM anon, authenticated;

-- 3. Guard classification function
CREATE OR REPLACE FUNCTION public.fn_classify_validate_guard(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curr record; v_prev record; v_step record;
  v_active_validate int; v_active_repair int; v_validate_24h int; v_repair_24h int;
  v_has_lease boolean; v_grace_until timestamptz; v_consecutive_no_progress int;
  v_progress boolean;
  v_da int; v_du int; v_dl int; v_dc int; v_dr int;
BEGIN
  SELECT * INTO v_curr FROM exam_pool_validation_snapshots WHERE package_id = p_package_id ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_prev FROM exam_pool_validation_snapshots WHERE package_id = p_package_id ORDER BY created_at DESC OFFSET 1 LIMIT 1;
  SELECT meta, attempts INTO v_step FROM package_steps WHERE package_id = p_package_id AND step_key = 'validate_exam_pool';

  SELECT COUNT(*) FILTER (WHERE job_type = 'package_validate_exam_pool' AND status IN ('pending','processing')),
         COUNT(*) FILTER (WHERE job_type = 'package_repair_exam_pool_quality' AND status IN ('pending','processing')),
         COUNT(*) FILTER (WHERE job_type = 'package_validate_exam_pool' AND created_at > now() - interval '24 hours'),
         COUNT(*) FILTER (WHERE job_type = 'package_repair_exam_pool_quality' AND created_at > now() - interval '24 hours')
  INTO v_active_validate, v_active_repair, v_validate_24h, v_repair_24h
  FROM job_queue WHERE package_id = p_package_id AND job_type IN ('package_validate_exam_pool','package_repair_exam_pool_quality');

  SELECT EXISTS(SELECT 1 FROM package_leases WHERE package_id = p_package_id AND lease_until > now()) INTO v_has_lease;
  v_grace_until := (v_step.meta->>'grace_until')::timestamptz;
  v_consecutive_no_progress := COALESCE((v_step.meta->>'consecutive_no_progress')::int, 0);

  IF v_prev.id IS NOT NULL AND v_curr.id IS NOT NULL THEN
    v_da := v_curr.approved_count - v_prev.approved_count;
    v_dr := v_curr.review_count - v_prev.review_count;
    v_du := v_curr.unresolved_quality_flags - v_prev.unresolved_quality_flags;
    v_dl := v_curr.missing_lf_coverage - v_prev.missing_lf_coverage;
    v_dc := v_curr.missing_competency_coverage - v_prev.missing_competency_coverage;
  ELSE
    v_da := 0; v_dr := 0; v_du := 0; v_dl := 0; v_dc := 0;
  END IF;

  v_progress := (v_da > 0) OR (v_dr < 0) OR (v_du < 0) OR (v_dl < 0) OR (v_dc < 0);

  IF v_progress THEN
    RETURN jsonb_build_object('guard_state','healthy','reason_code',NULL,'action','allow',
      'delta_approved',v_da,'delta_unresolved_flags',v_du,'delta_missing_lf_coverage',v_dl);
  END IF;
  IF v_grace_until IS NOT NULL AND v_grace_until > now() THEN
    RETURN jsonb_build_object('guard_state','recovering','reason_code','RECENT_HEAL_GRACE_ACTIVE','action','allow_wait','grace_until',v_grace_until::text);
  END IF;
  IF v_active_validate > 0 OR v_active_repair > 0 OR v_has_lease THEN
    RETURN jsonb_build_object('guard_state','recovering','reason_code','REPAIR_RUNNING_AWAITING_DELTA','action','allow_wait');
  END IF;
  IF v_validate_24h >= 6 AND v_consecutive_no_progress >= 2 AND v_repair_24h = 0 THEN
    RETURN jsonb_build_object('guard_state','soft_stalled','reason_code','VALIDATE_EXAM_POOL_SOFT_STALL','action','enqueue_repair',
      'validate_attempts_24h',v_validate_24h,'consecutive_no_progress',v_consecutive_no_progress);
  END IF;
  IF v_validate_24h >= 12 AND v_consecutive_no_progress >= 4 AND v_repair_24h >= 2
     AND NOT v_progress AND v_active_validate = 0 AND v_active_repair = 0
     AND NOT v_has_lease AND (v_grace_until IS NULL OR v_grace_until <= now()) THEN
    RETURN jsonb_build_object('guard_state','hard_stalled','reason_code','VALIDATE_EXAM_POOL_TRUE_STALL','action','block',
      'validate_attempts_24h',v_validate_24h,'repair_attempts_24h',v_repair_24h,'consecutive_no_progress',v_consecutive_no_progress);
  END IF;
  IF v_consecutive_no_progress >= 2 THEN
    RETURN jsonb_build_object('guard_state','soft_stalled','reason_code','NO_PROGRESS_AFTER_REPAIR','action','requeue_validate');
  END IF;
  RETURN jsonb_build_object('guard_state','healthy','reason_code',NULL,'action','allow');
END;
$$;
