
-- 1) admin_bulk_heal_no_step_history: ersetze (action_type, package_id, payload, created_at)
CREATE OR REPLACE FUNCTION public.admin_bulk_heal_no_step_history(p_dry_run boolean DEFAULT true, p_package_ids uuid[] DEFAULT NULL::uuid[], p_min_approved integer DEFAULT 100)
 RETURNS TABLE(package_id uuid, action text, prev_status text, prev_blocked_reason text, next_status text, approved_q integer, active_jobs integer, next_step text, notes text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record; v_next_step text; v_approved int; v_active int; v_action text;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.status, cp.blocked_reason
    FROM course_packages cp
    WHERE cp.status = 'blocked'
      AND (p_package_ids IS NULL OR cp.id = ANY(p_package_ids))
  LOOP
    SELECT count(*) INTO v_approved FROM exam_questions WHERE package_id = v_pkg.id AND status='approved';
    SELECT count(*) INTO v_active FROM job_queue WHERE package_id = v_pkg.id AND status IN ('queued','running');

    IF v_active > 0 THEN
      package_id:=v_pkg.id; action:='skip'; prev_status:=v_pkg.status; prev_blocked_reason:=v_pkg.blocked_reason;
      next_status:=v_pkg.status; approved_q:=v_approved; active_jobs:=v_active; next_step:=NULL; notes:='active jobs exist';
      RETURN NEXT; CONTINUE;
    END IF;

    IF v_approved < p_min_approved THEN
      package_id:=v_pkg.id; action:='skip'; prev_status:=v_pkg.status; prev_blocked_reason:=v_pkg.blocked_reason;
      next_status:=v_pkg.status; approved_q:=v_approved; active_jobs:=v_active; next_step:=NULL; notes:='approved questions below threshold';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT ps.step_key INTO v_next_step
    FROM package_steps ps
    WHERE ps.package_id = v_pkg.id AND ps.status IN ('queued','pending_enqueue')
    ORDER BY CASE ps.step_key
      WHEN 'run_integrity_check' THEN 1 WHEN 'repair_exam_pool_quality' THEN 2
      WHEN 'validate_exam_pool' THEN 3 WHEN 'quality_council' THEN 4
      WHEN 'elite_harden' THEN 5 WHEN 'generate_oral_exam' THEN 6
      WHEN 'validate_oral_exam' THEN 7 WHEN 'build_ai_tutor_index' THEN 8
      WHEN 'validate_tutor_index' THEN 9 WHEN 'auto_publish' THEN 10 ELSE 99 END,
      ps.updated_at ASC LIMIT 1;

    v_action := CASE WHEN p_dry_run THEN 'plan' ELSE 'heal' END;

    IF NOT p_dry_run THEN
      UPDATE course_packages SET status='building', blocked_reason=NULL, updated_at=now() WHERE id=v_pkg.id;
      UPDATE package_steps SET status='queued', updated_at=now()
        WHERE package_id=v_pkg.id AND status='pending_enqueue';

      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES (
        'bulk_heal_no_step_history',
        'admin_bulk_heal_no_step_history',
        'package', v_pkg.id::text, 'healed',
        jsonb_build_object(
          'package_id', v_pkg.id,
          'prev_status', v_pkg.status,
          'prev_blocked_reason', v_pkg.blocked_reason,
          'approved_q', v_approved,
          'active_jobs', v_active,
          'next_step', v_next_step,
          'min_approved', p_min_approved
        )
      );
    END IF;

    package_id:=v_pkg.id; action:=v_action; prev_status:=v_pkg.status; prev_blocked_reason:=v_pkg.blocked_reason;
    next_status:=CASE WHEN p_dry_run THEN v_pkg.status ELSE 'building' END;
    approved_q:=v_approved; active_jobs:=v_active; next_step:=v_next_step;
    notes:='cleared blocked_reason, status→building, normalized pending_enqueue→queued';
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- 2) admin_seo_create_draft_package
CREATE OR REPLACE FUNCTION public.admin_seo_create_draft_package(p_curriculum_id uuid, p_title text, p_track text DEFAULT 'EXAM_FIRST'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid(); v_pkg_id uuid;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;
  IF p_curriculum_id IS NULL THEN RAISE EXCEPTION 'curriculum_id_required'; END IF;
  IF p_title IS NULL OR length(trim(p_title))=0 THEN RAISE EXCEPTION 'title_required'; END IF;

  INSERT INTO public.course_packages (curriculum_id, title, track, status)
  VALUES (p_curriculum_id, trim(p_title), p_track, 'draft') RETURNING id INTO v_pkg_id;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('seo_dead_end_create_draft_package','admin_seo_dead_end_cockpit','package', v_pkg_id::text,'healed',
    jsonb_build_object('package_id', v_pkg_id, 'curriculum_id', p_curriculum_id, 'title', p_title, 'track', p_track, 'caller', v_caller));

  RETURN jsonb_build_object('ok', true, 'package_id', v_pkg_id, 'status', 'draft');
END;
$function$;

-- 3) admin_seo_republish_package
CREATE OR REPLACE FUNCTION public.admin_seo_republish_package(p_package_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid(); v_old_status text; v_new_status text;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;
  SELECT status INTO v_old_status FROM public.course_packages WHERE id=p_package_id;
  IF v_old_status IS NULL THEN RAISE EXCEPTION 'package_not_found: %', p_package_id; END IF;

  UPDATE public.course_packages SET status='published', updated_at=now()
   WHERE id=p_package_id RETURNING status INTO v_new_status;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('seo_dead_end_republish_package','admin_seo_dead_end_cockpit','package', p_package_id::text,'healed',
    jsonb_build_object('package_id', p_package_id, 'old_status', v_old_status, 'new_status', v_new_status, 'caller', v_caller));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'old_status', v_old_status, 'new_status', v_new_status);
END;
$function$;

-- 4) admin_seo_set_page_draft
CREATE OR REPLACE FUNCTION public.admin_seo_set_page_draft(p_seo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid(); v_slug text;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;
  UPDATE public.seo_content_pages SET status='draft', updated_at=now() WHERE id=p_seo_id RETURNING slug INTO v_slug;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'seo_page_not_found: %', p_seo_id; END IF;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('seo_dead_end_set_draft','admin_seo_dead_end_cockpit','seo_page', p_seo_id::text,'healed',
    jsonb_build_object('seo_id', p_seo_id, 'slug', v_slug, 'caller', v_caller));

  RETURN jsonb_build_object('ok', true, 'seo_id', p_seo_id, 'slug', v_slug, 'status', 'draft');
END;
$function$;

-- 5) admin_seo_set_product_override
CREATE OR REPLACE FUNCTION public.admin_seo_set_product_override(p_seo_id uuid, p_product_slug text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid(); v_old text; v_new text;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden: admin role required'; END IF;
  IF p_product_slug IS NULL OR length(trim(p_product_slug))=0 THEN RAISE EXCEPTION 'invalid_product_slug'; END IF;

  SELECT product_slug_override INTO v_old FROM public.certification_seo_pages WHERE id=p_seo_id;
  UPDATE public.certification_seo_pages SET product_slug_override=trim(p_product_slug), updated_at=now()
   WHERE id=p_seo_id RETURNING product_slug_override INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'cert_seo_not_found: %', p_seo_id; END IF;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('seo_dead_end_set_product_override','admin_seo_dead_end_cockpit','seo_page', p_seo_id::text,'healed',
    jsonb_build_object('seo_id', p_seo_id, 'old_override', v_old, 'new_override', v_new, 'caller', v_caller));

  RETURN jsonb_build_object('ok', true, 'seo_id', p_seo_id, 'product_slug_override', v_new);
END;
$function$;

-- 6) fn_reap_stale_jobs_aggressive: 'action' → 'action_type', 'payload' → 'metadata'
CREATE OR REPLACE FUNCTION public.fn_reap_stale_jobs_aggressive()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_unlocked int:=0; v_cancelled int:=0; v_terminal int:=0;
BEGIN
  WITH hard_cancel AS (
    UPDATE public.job_queue jq
    SET status='cancelled', completed_at=now(), updated_at=now(),
        last_error_code='STALE_REAPER_TERMINAL',
        last_error='Cancelled after >=5 liveness recoveries (stale_reaper_aggressive)',
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'stale_reaper_terminal_at', to_jsonb(now()),
          'stale_reaper_reason','liveness_recoveries_exhausted')
    WHERE jq.status IN ('processing','running','pending')
      AND COALESCE((jq.meta->>'liveness_requeued')::boolean,false)=true
      AND COALESCE((jq.meta->>'transient_attempts')::int,0) >= 5
    RETURNING jq.id
  )
  SELECT count(*) INTO v_cancelled FROM hard_cancel;

  UPDATE public.job_queue SET status='pending', locked_at=NULL, locked_by=NULL, updated_at=now(),
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'stale_reaper_unlocked_at', to_jsonb(now()), 'stale_reaper_reason','orphan_lock_no_start')
  WHERE status='processing' AND started_at IS NULL
    AND locked_at < now() - interval '15 minutes'
    AND COALESCE((meta->>'transient_attempts')::int,0) < 5;
  GET DIAGNOSTICS v_unlocked = ROW_COUNT;

  UPDATE public.job_queue SET status='cancelled', completed_at=now(), updated_at=now(),
    last_error_code='MAX_ATTEMPTS_TERMINAL',
    last_error=COALESCE(last_error,'Cancelled: max_attempts exhausted'),
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'stale_reaper_terminal_at', to_jsonb(now()), 'stale_reaper_reason','max_attempts_exhausted')
  WHERE status IN ('processing','pending','running')
    AND attempts >= max_attempts
    AND updated_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_terminal = ROW_COUNT;

  BEGIN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, result_status, metadata)
    VALUES ('stale_reaper_aggressive_run','fn_reap_stale_jobs_aggressive','system','healed',
      jsonb_build_object('unlocked',v_unlocked,'hard_cancelled',v_cancelled,'terminal_blocked',v_terminal,'ts',now()));
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

  RETURN jsonb_build_object('unlocked',v_unlocked,'hard_cancelled',v_cancelled,'terminal_blocked',v_terminal,'ts',now());
END;
$function$;
