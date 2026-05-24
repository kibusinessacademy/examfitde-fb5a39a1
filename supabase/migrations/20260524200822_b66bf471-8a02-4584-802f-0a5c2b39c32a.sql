-- P1.1 Governance Recovery Verifier
-- SSOT view for dispatch outcomes, verifier function, admin RPC, cron 30min

-- 1) Outcome SSOT view (service_role only)
CREATE OR REPLACE VIEW public.v_governance_completion_recovery_outcomes
WITH (security_invoker = false) AS
WITH dispatches AS (
  SELECT
    ahl.id                                              AS audit_id,
    ahl.created_at                                      AS dispatched_at,
    (ahl.target_id)::uuid                               AS package_id,
    ahl.metadata->>'package_key'                        AS package_key,
    (ahl.metadata->>'job_id')::uuid                     AS job_id,
    ahl.metadata->'reason_codes'                        AS reason_codes,
    ahl.metadata->>'risk_level'                         AS risk_level,
    ROW_NUMBER() OVER (PARTITION BY (ahl.target_id)::uuid ORDER BY ahl.created_at DESC) AS rn
  FROM public.auto_heal_log ahl
  WHERE ahl.action_type = 'governance_completion_recovery_dispatched'
    AND ahl.created_at > now() - interval '7 days'
)
SELECT
  d.audit_id,
  d.dispatched_at,
  d.package_id,
  d.package_key,
  d.job_id,
  d.reason_codes,
  d.risk_level,
  jq.status                                             AS job_status,
  jq.last_error                                         AS job_last_error,
  jq.completed_at                                       AS job_completed_at,
  cp.status                                             AS package_status,
  (cp.quality_report IS NOT NULL)                       AS quality_report_written,
  COALESCE((cp.quality_report->>'overall_score')::numeric,
           (cp.quality_report->>'score')::numeric)      AS quality_score,
  cp.council_approved                                   AS council_approved,
  EXTRACT(EPOCH FROM (now() - d.dispatched_at))/60.0    AS minutes_since_dispatch,
  -- Recovered = quality_report now exists AND job completed
  (cp.quality_report IS NOT NULL
     AND jq.status = 'completed')                       AS recovered,
  -- Stuck = no quality_report after 60 min AND (failed OR cancelled OR pending too long)
  (cp.quality_report IS NULL
     AND EXTRACT(EPOCH FROM (now() - d.dispatched_at))/60.0 > 60
     AND (jq.status IN ('failed','cancelled')
          OR (jq.status IN ('pending','processing')
              AND EXTRACT(EPOCH FROM (now() - d.dispatched_at))/60.0 > 120))
  )                                                     AS stuck,
  CASE
    WHEN cp.quality_report IS NOT NULL AND jq.status = 'completed' THEN NULL
    WHEN jq.status = 'failed' THEN COALESCE(jq.last_error, 'job_failed')
    WHEN jq.status = 'cancelled' THEN 'job_cancelled'
    WHEN jq.status IN ('pending','processing')
         AND EXTRACT(EPOCH FROM (now() - d.dispatched_at))/60.0 > 120 THEN 'stalled_in_queue'
    WHEN cp.quality_report IS NULL AND jq.status = 'completed' THEN 'job_done_no_report'
    ELSE NULL
  END                                                   AS failure_reason,
  d.rn = 1                                              AS is_latest_dispatch
FROM dispatches d
LEFT JOIN public.job_queue jq ON jq.id = d.job_id
LEFT JOIN public.course_packages cp ON cp.id = d.package_id;

REVOKE ALL ON public.v_governance_completion_recovery_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_governance_completion_recovery_outcomes TO service_role;

-- 2) Audit contract registration
INSERT INTO public.ops_audit_contract(action_type, required_keys, schema_version, owner_module)
VALUES
  ('governance_completion_recovery_verified',
    ARRAY['package_key','job_id','recovered','stuck','minutes_since_dispatch']::text[],
    1, 'p1.1_governance_recovery_verifier'),
  ('governance_completion_recovery_stuck',
    ARRAY['package_key','job_id','failure_reason','minutes_since_dispatch']::text[],
    1, 'p1.1_governance_recovery_verifier')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      schema_version = EXCLUDED.schema_version,
      updated_at = now();

-- 3) Verifier function (audit-only, no mutations)
CREATE OR REPLACE FUNCTION public.fn_verify_governance_completion_recovery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_verified int := 0;
  v_stuck int := 0;
  v_skipped int := 0;
  v_already_audited boolean;
BEGIN
  FOR r IN
    SELECT *
    FROM public.v_governance_completion_recovery_outcomes
    WHERE is_latest_dispatch = true
      AND dispatched_at > now() - interval '24 hours'
      AND minutes_since_dispatch >= 5  -- give pipeline time
  LOOP
    -- Idempotency: avoid duplicate audit per (package_id, job_id, classification)
    IF r.recovered THEN
      SELECT EXISTS (
        SELECT 1 FROM public.auto_heal_log
        WHERE action_type = 'governance_completion_recovery_verified'
          AND target_id = r.package_id::text
          AND (metadata->>'job_id')::uuid = r.job_id
      ) INTO v_already_audited;

      IF v_already_audited THEN
        v_skipped := v_skipped + 1;
      ELSE
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
        VALUES (
          'governance_completion_recovery_verified',
          r.package_id::text, 'course_package', 'success',
          jsonb_build_object(
            'package_key', r.package_key,
            'job_id', r.job_id,
            'recovered', true,
            'stuck', false,
            'minutes_since_dispatch', round(r.minutes_since_dispatch::numeric, 2),
            'quality_score', r.quality_score,
            'council_approved', r.council_approved
          )
        );
        v_verified := v_verified + 1;
      END IF;

    ELSIF r.stuck THEN
      SELECT EXISTS (
        SELECT 1 FROM public.auto_heal_log
        WHERE action_type = 'governance_completion_recovery_stuck'
          AND target_id = r.package_id::text
          AND (metadata->>'job_id')::uuid = r.job_id
      ) INTO v_already_audited;

      IF v_already_audited THEN
        v_skipped := v_skipped + 1;
      ELSE
        INSERT INTO public.auto_heal_log(action_type, target_id, target_type, result_status, metadata)
        VALUES (
          'governance_completion_recovery_stuck',
          r.package_id::text, 'course_package', 'failed',
          jsonb_build_object(
            'package_key', r.package_key,
            'job_id', r.job_id,
            'failure_reason', COALESCE(r.failure_reason, 'unknown'),
            'minutes_since_dispatch', round(r.minutes_since_dispatch::numeric, 2),
            'job_status', r.job_status,
            'recovered', false,
            'stuck', true
          )
        );
        v_stuck := v_stuck + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'verified', v_verified,
    'stuck', v_stuck,
    'skipped_duplicate', v_skipped,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_verify_governance_completion_recovery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_verify_governance_completion_recovery() TO service_role;

-- 4) Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_get_governance_completion_recovery_outcomes(p_hours int DEFAULT 24)
RETURNS SETOF public.v_governance_completion_recovery_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;
  IF p_hours IS NULL OR p_hours < 1 THEN p_hours := 24; END IF;
  IF p_hours > 168 THEN p_hours := 168; END IF;

  RETURN QUERY
  SELECT * FROM public.v_governance_completion_recovery_outcomes
  WHERE dispatched_at > now() - make_interval(hours => p_hours)
  ORDER BY dispatched_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_governance_completion_recovery_outcomes(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_governance_completion_recovery_outcomes(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_governance_completion_recovery_outcomes_summary(p_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatched int := 0;
  v_recovered int := 0;
  v_stuck int := 0;
  v_pending int := 0;
  v_avg_min numeric;
  v_top_reasons jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;
  IF p_hours IS NULL OR p_hours < 1 THEN p_hours := 24; END IF;
  IF p_hours > 168 THEN p_hours := 168; END IF;

  SELECT
    count(*) FILTER (WHERE is_latest_dispatch),
    count(*) FILTER (WHERE is_latest_dispatch AND recovered),
    count(*) FILTER (WHERE is_latest_dispatch AND stuck),
    count(*) FILTER (WHERE is_latest_dispatch AND NOT recovered AND NOT stuck),
    avg(minutes_since_dispatch) FILTER (WHERE is_latest_dispatch AND recovered)
  INTO v_dispatched, v_recovered, v_stuck, v_pending, v_avg_min
  FROM public.v_governance_completion_recovery_outcomes
  WHERE dispatched_at > now() - make_interval(hours => p_hours);

  SELECT COALESCE(jsonb_object_agg(failure_reason, cnt), '{}'::jsonb)
  INTO v_top_reasons
  FROM (
    SELECT failure_reason, count(*) AS cnt
    FROM public.v_governance_completion_recovery_outcomes
    WHERE is_latest_dispatch AND stuck
      AND failure_reason IS NOT NULL
      AND dispatched_at > now() - make_interval(hours => p_hours)
    GROUP BY failure_reason
    ORDER BY count(*) DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'window_hours', p_hours,
    'dispatched_24h', v_dispatched,
    'recovered_24h', v_recovered,
    'stuck_24h', v_stuck,
    'pending_24h', v_pending,
    'recovery_rate', CASE WHEN v_dispatched > 0
                          THEN round((v_recovered::numeric / v_dispatched) * 100, 2)
                          ELSE NULL END,
    'avg_minutes_to_recover', round(COALESCE(v_avg_min, 0)::numeric, 2),
    'top_failure_reasons', v_top_reasons,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_governance_completion_recovery_outcomes_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_governance_completion_recovery_outcomes_summary(int) TO authenticated;

-- 5) Cron 30min
SELECT cron.schedule(
  'governance-completion-recovery-verify-30min',
  '*/30 * * * *',
  $cron$ SELECT public.fn_verify_governance_completion_recovery(); $cron$
);