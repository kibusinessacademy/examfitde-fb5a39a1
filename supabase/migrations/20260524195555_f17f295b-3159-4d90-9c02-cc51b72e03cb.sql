
-- =============================================================
-- P1 Governance Completion Recovery
-- =============================================================

-- 1. Recovery targets view ------------------------------------
CREATE OR REPLACE VIEW public.v_governance_completion_recovery_targets AS
WITH approved_counts AS (
  SELECT package_id, COUNT(*)::int AS approved_question_count
  FROM public.exam_questions
  WHERE status = 'approved'
  GROUP BY package_id
),
active_governance_jobs AS (
  SELECT package_id, COUNT(*)::int AS active_jobs
  FROM public.job_queue
  WHERE job_type IN ('package_quality_council','package_run_integrity_check','package_auto_publish')
    AND status IN ('pending','queued','processing','running','claimed')
  GROUP BY package_id
),
council_failures_24h AS (
  SELECT package_id, COUNT(*)::int AS failed_24h
  FROM public.job_queue
  WHERE job_type = 'package_quality_council'
    AND status = 'failed'
    AND created_at > now() - interval '24 hours'
  GROUP BY package_id
),
integrity_fails_24h AS (
  SELECT package_id, COUNT(*)::int AS fail_24h
  FROM public.job_queue
  WHERE job_type = 'package_run_integrity_check'
    AND status = 'failed'
    AND created_at > now() - interval '24 hours'
  GROUP BY package_id
),
recent_recovery AS (
  SELECT target_id::uuid AS package_id, MAX(created_at) AS last_dispatch_at
  FROM public.auto_heal_log
  WHERE action_type = 'governance_completion_recovery_dispatched'
    AND created_at > now() - interval '24 hours'
  GROUP BY target_id
)
SELECT
  cp.id AS package_id,
  cp.package_key,
  cp.title,
  cp.status AS package_status,
  COALESCE(ac.approved_question_count, 0) AS approved_question_count,
  COALESCE(ig.fail_24h, 0) AS integrity_fail_count_24h,
  COALESCE(cf.failed_24h, 0) AS council_jobs_failed_24h,
  CASE
    WHEN cp.quality_report IS NULL THEN 1
    ELSE 0
  END AS council_jobs_missing,
  'package_quality_council'::text AS recommended_recovery_job,
  CASE
    WHEN COALESCE(cf.failed_24h, 0) >= 3 THEN 'high'
    WHEN COALESCE(cf.failed_24h, 0) >= 1 THEN 'medium'
    ELSE 'low'
  END AS risk_level,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN cp.quality_report IS NULL THEN 'no_quality_report' END,
    CASE WHEN cp.council_approved IS NOT TRUE THEN 'council_not_approved' END,
    CASE WHEN COALESCE(ig.fail_24h,0) > 0 THEN 'integrity_downstream_failure' END,
    CASE WHEN COALESCE(cf.failed_24h,0) > 0 THEN 'council_recently_failed' END
  ], NULL) AS reason_codes,
  COALESCE(agj.active_jobs, 0) AS active_governance_jobs,
  rr.last_dispatch_at,
  cp.feature_flags
FROM public.course_packages cp
JOIN approved_counts ac ON ac.package_id = cp.id
LEFT JOIN active_governance_jobs agj ON agj.package_id = cp.id
LEFT JOIN council_failures_24h cf ON cf.package_id = cp.id
LEFT JOIN integrity_fails_24h ig ON ig.package_id = cp.id
LEFT JOIN recent_recovery rr ON rr.package_id = cp.id
WHERE ac.approved_question_count >= 150
  AND cp.is_published = false
  AND cp.archived = false
  AND cp.status NOT IN ('failed_terminal','manual_hold','archived')
  AND cp.quality_report IS NULL
  AND COALESCE((cp.feature_flags->'bronze'->>'manual_review_required')::boolean, false) = false;

REVOKE ALL ON public.v_governance_completion_recovery_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_governance_completion_recovery_targets TO service_role;

-- 2. Recovery dispatch RPC ------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dispatch_governance_completion_recovery(
  p_limit int DEFAULT 25,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target record;
  v_planned int := 0;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_skip_reasons jsonb := '{}'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_skip_reason text;
  v_inserted_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 25; END IF;
  IF p_limit > 100 THEN p_limit := 100; END IF;

  FOR v_target IN
    SELECT *
    FROM public.v_governance_completion_recovery_targets
    ORDER BY risk_level DESC, approved_question_count DESC
    LIMIT p_limit
  LOOP
    v_skip_reason := NULL;

    -- Dispatch guards
    IF v_target.active_governance_jobs > 0 THEN
      v_skip_reason := 'active_governance_job_exists';
    ELSIF v_target.last_dispatch_at IS NOT NULL
          AND v_target.last_dispatch_at > now() - interval '6 hours' THEN
      v_skip_reason := 'idempotency_6h_cooldown';
    ELSIF v_target.council_jobs_failed_24h > 5 THEN
      v_skip_reason := 'too_many_council_failures_24h';
    ELSIF COALESCE((v_target.feature_flags->'bronze'->>'manual_review_required')::boolean, false) THEN
      v_skip_reason := 'bronze_manual_review_required';
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_skip_reasons := v_skip_reasons || jsonb_build_object(
        v_skip_reason, COALESCE((v_skip_reasons->>v_skip_reason)::int, 0) + 1
      );
      IF NOT p_dry_run THEN
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
        VALUES (
          'governance_completion_recovery_skipped',
          v_target.package_id::text,
          'course_package',
          'skipped',
          jsonb_build_object(
            'package_key', v_target.package_key,
            'reason_codes', v_target.reason_codes,
            'skip_reason', v_skip_reason,
            'last_dispatch_at', v_target.last_dispatch_at,
            'dry_run', false
          )
        );
      END IF;
      v_actions := v_actions || jsonb_build_object(
        'package_id', v_target.package_id,
        'package_key', v_target.package_key,
        'action', 'skip',
        'skip_reason', v_skip_reason
      );
      CONTINUE;
    END IF;

    v_planned := v_planned + 1;

    IF NOT p_dry_run THEN
      -- Dispatch ONE governance job
      INSERT INTO public.job_queue(job_type, package_id, status, meta, priority)
      VALUES (
        'package_quality_council',
        v_target.package_id,
        'pending',
        jsonb_build_object(
          'enqueue_source', 'governance_completion_recovery',
          'reason_codes', v_target.reason_codes,
          'recovery_risk_level', v_target.risk_level
        ),
        50
      )
      RETURNING id INTO v_inserted_id;

      IF v_inserted_id IS NOT NULL THEN
        v_dispatched := v_dispatched + 1;
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
        VALUES (
          'governance_completion_recovery_dispatched',
          v_target.package_id::text,
          'course_package',
          'success',
          jsonb_build_object(
            'package_key', v_target.package_key,
            'reason_codes', v_target.reason_codes,
            'job_id', v_inserted_id,
            'job_type', 'package_quality_council',
            'risk_level', v_target.risk_level,
            'approved_question_count', v_target.approved_question_count,
            'dry_run', false
          )
        );
      ELSE
        -- Guard fired (silent drop) — log skip
        v_skipped := v_skipped + 1;
        v_skip_reasons := v_skip_reasons || jsonb_build_object(
          'enqueue_guard_suppressed', COALESCE((v_skip_reasons->>'enqueue_guard_suppressed')::int, 0) + 1
        );
      END IF;
    END IF;

    v_actions := v_actions || jsonb_build_object(
      'package_id', v_target.package_id,
      'package_key', v_target.package_key,
      'action', CASE WHEN p_dry_run THEN 'plan_dispatch' ELSE 'dispatched' END,
      'job_type', 'package_quality_council',
      'risk_level', v_target.risk_level,
      'reason_codes', v_target.reason_codes
    );
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'limit', p_limit,
    'planned_dispatches', v_planned,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'skip_reasons', v_skip_reasons,
    'actions', v_actions,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_governance_completion_recovery(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_governance_completion_recovery(int, boolean) TO authenticated;

-- 3. Summary RPC ---------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_governance_completion_recovery_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending int;
  v_dispatched_24h int;
  v_skipped_24h int;
  v_recovered_24h int;
  v_still_missing int;
  v_top_reasons jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;

  SELECT COUNT(*) INTO v_pending FROM public.v_governance_completion_recovery_targets;

  SELECT COUNT(*) INTO v_dispatched_24h
  FROM public.auto_heal_log
  WHERE action_type = 'governance_completion_recovery_dispatched'
    AND created_at > now() - interval '24 hours';

  SELECT COUNT(*) INTO v_skipped_24h
  FROM public.auto_heal_log
  WHERE action_type = 'governance_completion_recovery_skipped'
    AND created_at > now() - interval '24 hours';

  SELECT COUNT(DISTINCT cp.id) INTO v_recovered_24h
  FROM public.auto_heal_log ahl
  JOIN public.course_packages cp ON cp.id::text = ahl.target_id
  WHERE ahl.action_type = 'governance_completion_recovery_dispatched'
    AND ahl.created_at > now() - interval '24 hours'
    AND cp.quality_report IS NOT NULL;

  SELECT COUNT(*) INTO v_still_missing
  FROM public.course_packages cp
  WHERE cp.quality_report IS NULL
    AND cp.is_published = false
    AND cp.archived = false
    AND cp.status NOT IN ('failed_terminal','manual_hold','archived');

  SELECT jsonb_object_agg(reason, cnt) INTO v_top_reasons
  FROM (
    SELECT unnest(reason_codes) AS reason, COUNT(*)::int AS cnt
    FROM public.v_governance_completion_recovery_targets
    GROUP BY 1
    ORDER BY cnt DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'pending_targets', v_pending,
    'dispatched_24h', v_dispatched_24h,
    'recovered_24h', v_recovered_24h,
    'skipped_24h', v_skipped_24h,
    'packages_still_missing_reports', v_still_missing,
    'top_reason_codes', COALESCE(v_top_reasons, '{}'::jsonb),
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_governance_completion_recovery_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_governance_completion_recovery_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
