
CREATE OR REPLACE FUNCTION public.claim_recovery_pulse(
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_worker_pool text DEFAULT 'default'::text
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session_role text := session_user::text;
  v_current_role text := current_user::text;
  v_set_role     text := current_setting('role', true);
  v_allowed      boolean;
BEGIN
  v_allowed :=
       v_session_role IN ('postgres','supabase_admin','service_role')
    OR v_current_role IN ('postgres','supabase_admin','service_role')
    OR v_set_role     IN ('postgres','supabase_admin','service_role');

  IF NOT v_allowed THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('recovery_pulse_role_denied','system','blocked',
            jsonb_build_object(
              'worker_id', p_worker_id,
              'session_user', v_session_role,
              'current_user', v_current_role,
              'set_role', v_set_role
            ));
    RAISE EXCEPTION 'recovery_pulse requires service_role (got session=% current=% set_role=%)',
      v_session_role, v_current_role, COALESCE(v_set_role,'<null>');
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
      AND (cp.id IS NULL OR cp.status = 'building' OR COALESCE(jtp.can_run_when_not_building, false))
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type
          AND q.cleared_at IS NULL
          AND q.blocked_until > now()
      )
      AND (
        jq.job_type NOT LIKE 'package_%'
        OR (jq.payload->>'package_id') IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.step_dag_edges dag
          JOIN public.package_steps ps
            ON ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = dag.depends_on
          WHERE dag.step_key = replace(jq.job_type, 'package_', '')
            AND ps.status NOT IN ('done', 'skipped')
        )
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status='processing', locked_at=now(), locked_by=p_worker_id,
      started_at=now(), attempts=COALESCE(q.attempts,0)+1, updated_at=now()
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_recovery_pulse_role_denials(p_window_min int DEFAULT 60)
RETURNS TABLE(at timestamptz, sess_user text, curr_user text, set_role text, worker_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  SELECT a.created_at,
         (a.metadata->>'session_user')::text,
         (a.metadata->>'current_user')::text,
         (a.metadata->>'set_role')::text,
         (a.metadata->>'worker_id')::text
    FROM public.auto_heal_log a
   WHERE a.action_type='recovery_pulse_role_denied'
     AND a.created_at > now() - make_interval(mins => p_window_min)
   ORDER BY a.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_recovery_pulse_role_denials(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_recovery_pulse_role_denials(int) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_smoke_growth_audit_null_post_score()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg uuid;
  v_run_cta uuid;
  v_run_funnel uuid;
  v_res_cta jsonb;
  v_res_funnel jsonb;
  v_classifier jsonb;
  v_status_cta text;
  v_status_funnel text;
  v_reason_cta text;
  v_reason_funnel text;
  v_pass boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT id INTO v_pkg FROM public.course_packages
   WHERE status='published' ORDER BY created_at DESC LIMIT 1;
  IF v_pkg IS NULL THEN RAISE EXCEPTION 'no_published_package_for_smoke'; END IF;

  v_run_cta := public.fn_growth_repair_start_run(v_pkg, 'cta');
  UPDATE public.growth_repair_runs SET pre_score=NULL WHERE id=v_run_cta;
  v_res_cta := public.fn_growth_repair_complete_run(
    v_run_cta,
    jsonb_build_object('audit', 'cta_smoke', 'mode', 'audit_only'),
    NULL, NULL, NULL
  );
  SELECT status INTO v_status_cta FROM public.growth_repair_runs WHERE id=v_run_cta;
  v_reason_cta := COALESCE(v_res_cta->'gate_reasons'->>0, '');

  v_run_funnel := public.fn_growth_repair_start_run(v_pkg, 'funnel_events');
  UPDATE public.growth_repair_runs SET pre_score=NULL WHERE id=v_run_funnel;
  v_res_funnel := public.fn_growth_repair_complete_run(
    v_run_funnel,
    jsonb_build_object('audit', 'funnel_smoke', 'mode', 'audit_only'),
    NULL, NULL, NULL
  );
  SELECT status INTO v_status_funnel FROM public.growth_repair_runs WHERE id=v_run_funnel;
  v_reason_funnel := COALESCE(v_res_funnel->'gate_reasons'->>0, '');

  v_classifier := jsonb_build_object(
    'check_landing_page_cta_render',
      public.fn_growth_classify_next_best_fix(
        jsonb_build_object('verdict','red','missing', jsonb_build_array('cta_visible')), 'cta'),
    'review_cta_copy_for_engagement',
      public.fn_growth_classify_next_best_fix(
        jsonb_build_object('verdict','yellow','low_engagement', true), 'cta'),
    'verify_checkout_event_wiring',
      public.fn_growth_classify_next_best_fix(
        jsonb_build_object('verdict','red','missing', jsonb_build_array('checkout_started')), 'funnel_events'),
    'verify_lead_form_wiring',
      public.fn_growth_classify_next_best_fix(
        jsonb_build_object('verdict','red','missing', jsonb_build_array('lead_submitted')), 'funnel_events')
  );

  v_pass :=
        v_status_cta = 'rolled_back'
    AND v_status_funnel = 'rolled_back'
    AND (v_reason_cta IN ('post_score_unavailable','pre_score_unavailable'))
    AND (v_reason_funnel IN ('post_score_unavailable','pre_score_unavailable'));

  RETURN jsonb_build_object(
    'pass', v_pass,
    'package_id', v_pkg,
    'cta', jsonb_build_object('run_id', v_run_cta, 'status', v_status_cta, 'reason', v_reason_cta, 'result', v_res_cta),
    'funnel', jsonb_build_object('run_id', v_run_funnel, 'status', v_status_funnel, 'reason', v_reason_funnel, 'result', v_res_funnel),
    'classifier_actions', v_classifier
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_smoke_growth_audit_null_post_score() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_growth_audit_null_post_score() TO authenticated;
