
-- 1) BEFORE INSERT Schema Guard
CREATE OR REPLACE FUNCTION public.fn_guard_auto_heal_log_schema()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.action_type IS NULL THEN
    RAISE EXCEPTION 'auto_heal_log: action_type required (legacy producer using payload/action/details detected). metadata=%', NEW.metadata
      USING ERRCODE='23502', HINT='Use canonical schema: action_type, trigger_source, target_type, target_id, result_status, metadata';
  END IF;
  -- Defensive: never accept rows where metadata is NULL but legacy field markers exist
  IF NEW.metadata IS NULL THEN NEW.metadata := '{}'::jsonb; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_auto_heal_log_schema ON public.auto_heal_log;
CREATE TRIGGER trg_guard_auto_heal_log_schema
BEFORE INSERT ON public.auto_heal_log
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_auto_heal_log_schema();

-- 2a) admin_seo_publish_drift_heal
CREATE OR REPLACE FUNCTION public.admin_seo_publish_drift_heal()
 RETURNS TABLE(curriculum_id uuid, pages_published integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.role()='service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT cp.curriculum_id FROM course_packages cp
    WHERE cp.status='published' AND COALESCE(cp.integrity_passed,false)=true
  ),
  upd AS (
    UPDATE seo_content_pages s SET status='published', updated_at=now()
    FROM eligible e WHERE s.curriculum_id = e.curriculum_id AND s.status='draft'
    RETURNING s.curriculum_id, s.id
  )
  SELECT u.curriculum_id, COUNT(*)::int FROM upd u GROUP BY u.curriculum_id;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, result_status, metadata)
  VALUES('seo_publish_drift_heal','admin_seo_publish_drift_heal','system','ok',
         jsonb_build_object('triggered_at', now()));
END $$;

-- 2b) admin_heal_exam_pool_too_small (package_id col → target_id)
CREATE OR REPLACE FUNCTION public.admin_heal_exam_pool_too_small(p_package_id uuid, p_force_chain_reset boolean DEFAULT false, p_dry_run boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := auth.uid(); v_is_admin boolean := false;
  v_pkg record; v_repair_action jsonb; v_recommended_step text;
  v_repair_recently_failed boolean := false; v_chain_reset_done boolean := false;
  v_nudged boolean := false; v_result jsonb; v_steps_to_reset text[];
BEGIN
  IF current_setting('role', true) = 'service_role' THEN v_is_admin := true;
  ELSIF v_caller IS NOT NULL THEN
    SELECT public.has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
  END IF;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;

  SELECT id, status, current_step, course_id INTO v_pkg
  FROM public.course_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found', 'package_id', p_package_id);
  END IF;

  BEGIN
    SELECT public.fn_select_exam_pool_repair_action(p_package_id) INTO v_repair_action;
  EXCEPTION WHEN OTHERS THEN
    v_repair_action := jsonb_build_object('action','unknown','reason',SQLERRM);
  END;
  v_recommended_step := COALESCE(v_repair_action->>'action','package_repair_exam_pool_quality');

  SELECT EXISTS (
    SELECT 1 FROM public.queue_jobs qj
    WHERE qj.package_id = p_package_id
      AND qj.job_type IN ('package_repair_exam_pool_quality','package_repair_exam_pool_lf_coverage','package_repair_exam_pool_competency_coverage')
      AND qj.status IN ('completed','failed')
      AND qj.completed_at > now() - interval '6 hours'
  ) INTO v_repair_recently_failed;

  IF p_force_chain_reset OR v_repair_recently_failed THEN
    v_steps_to_reset := ARRAY['generate_exam_pool','validate_exam_pool','repair_exam_pool_quality'];
    IF NOT p_dry_run THEN
      PERFORM public.admin_step_reset_detailed(
        p_package_id := p_package_id, p_step_keys := v_steps_to_reset,
        p_reason := 'exam_pool_too_small_combined_heal',
        p_operator := COALESCE(v_caller::text,'service_role'),
        p_allow_regression := true, p_clear_exhaustion := true);
      v_chain_reset_done := true;
      PERFORM public.admin_nudge_atomic_trigger(p_package_id, false);
      v_nudged := true;
    END IF;
  ELSE
    IF NOT p_dry_run THEN
      PERFORM public.admin_targeted_blocker_recheck(true);
      v_nudged := true;
    END IF;
  END IF;

  v_result := jsonb_build_object('ok',true,'package_id',p_package_id,'package_status',v_pkg.status,
    'current_step',v_pkg.current_step,'repair_action',v_repair_action,'recommended_step',v_recommended_step,
    'repair_recently_failed',v_repair_recently_failed,'chain_reset_done',v_chain_reset_done,
    'nudged',v_nudged,'dry_run',p_dry_run,'force_chain_reset',p_force_chain_reset);

  IF NOT p_dry_run THEN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
    VALUES ('exam_pool_too_small_combined_heal','admin_heal_exam_pool_too_small','package', p_package_id::text,'healed', v_result);
  END IF;
  RETURN v_result;
END;
$$;

-- 2c) fn_guard_council_session_step_gate
CREATE OR REPLACE FUNCTION public.fn_guard_council_session_step_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_step_status step_status;
BEGIN
  SELECT ps.status INTO v_step_status FROM package_steps ps
  WHERE ps.package_id = NEW.package_id AND ps.step_key = 'quality_council';
  IF v_step_status IN ('running','done') THEN RETURN NEW; END IF;

  INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('council_session_blocked_by_step_gate','fn_guard_council_session_step_gate','package', NEW.package_id::text,'blocked',
    jsonb_build_object('council_type', NEW.council_type, 'step_status', v_step_status::text,
      'reason','quality_council step not running/done'));

  RAISE WARNING '[council-step-gate] Blocked council_session for package % — quality_council step is %',
    NEW.package_id, COALESCE(v_step_status::text,'NOT_FOUND');
  RETURN NULL;
END;
$$;

-- 3) Monitoring view
CREATE OR REPLACE VIEW public.v_auto_heal_log_legacy_producers AS
SELECT n.nspname||'.'||p.proname AS func,
  (pg_get_functiondef(p.oid) ~* 'auto_heal_log[[:space:]]*\([^)]*\mpayload\M') AS bad_payload,
  (pg_get_functiondef(p.oid) ~* 'auto_heal_log[[:space:]]*\([^)]*\mtriggered_by\M') AS bad_triggered_by,
  (pg_get_functiondef(p.oid) ~* 'auto_heal_log[[:space:]]*\([^)]*\maction\M[^_]') AS bad_action_col,
  (pg_get_functiondef(p.oid) ~* 'auto_heal_log[[:space:]]*\([^)]*\mpackage_id\M') AS bad_package_id_col,
  (pg_get_functiondef(p.oid) ~* 'auto_heal_log[[:space:]]*\([^)]*\mdetails\M') AS bad_details_col
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND pg_get_functiondef(p.oid) ~* 'INSERT[[:space:]]+INTO[[:space:]]+(public\.)?auto_heal_log';

REVOKE ALL ON public.v_auto_heal_log_legacy_producers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_auto_heal_log_legacy_producers TO service_role;

-- 4) Drop legacy backfill function (one-off, dated 2026-05-04, no callers)
DROP FUNCTION IF EXISTS public._admin_backfill_council_verdict_2026_05_04();
