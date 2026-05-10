CREATE OR REPLACE FUNCTION public.admin_soft_drift_mc_repair(p_package_ids uuid[], p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_results jsonb := '[]'::jsonb; r record; v_active int; v_job_id uuid;
  v_action text; v_skip_reason text; v_required_tracks text[] := ARRAY[]::text[];
  v_job_name text; v_curr uuid;
BEGIN
  IF current_user NOT IN ('service_role','postgres')
     AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;

  SELECT array_agg(track) INTO v_required_tracks FROM public.track_step_applicability
  WHERE step_key='generate_lesson_minichecks' AND should_run=true;

  FOR r IN SELECT v.package_id,v.package_title, v.track::text AS track,
                  v.mc_total,v.mc_approved,v.mc_approval_pct,v.mc_required,v.risk_score
           FROM public.v_soft_drift_packages_ssot v WHERE v.package_id = ANY(p_package_ids)
  LOOP
    v_action:=NULL; v_skip_reason:=NULL; v_job_id:=NULL;
    IF NOT r.mc_required OR r.track <> ALL(v_required_tracks) THEN
      v_skip_reason:='mc_not_required_for_track';
    ELSIF upper(r.track)='EXAM_FIRST' THEN v_skip_reason:='exam_first_excluded';
    ELSIF r.mc_total=0 THEN v_skip_reason:='no_minichecks';
    ELSIF r.mc_approval_pct IS NULL OR r.mc_approval_pct >= 85 THEN v_skip_reason:='above_threshold';
    ELSE
      SELECT COUNT(*) INTO v_active FROM public.job_queue
      WHERE status IN ('pending','processing')
        AND job_type IN ('package_validate_lesson_minichecks','package_generate_lesson_minichecks')
        AND package_id = r.package_id;
      IF v_active>0 THEN v_skip_reason:='active_jobs_exist';
      ELSE
        v_action:='package_validate_lesson_minichecks';
        SELECT job_name INTO v_job_name FROM public.ops_job_type_registry WHERE job_type=v_action;
        SELECT curriculum_id INTO v_curr FROM public.course_packages WHERE id = r.package_id;
        IF NOT p_dry_run THEN
          INSERT INTO public.job_queue (job_type, job_name, package_id, payload, status, priority, max_attempts, scheduled_at, meta)
          VALUES (
            v_action, COALESCE(v_job_name,'Package Validate Lesson Minichecks'), r.package_id,
            jsonb_build_object('package_id',r.package_id,'curriculum_id',v_curr,
              'enqueue_source','soft_drift_mc_required_repair','reason','mc_approval_pct_below_85'),
            'pending', 50, 3, now(),
            jsonb_build_object('enqueue_source','soft_drift_mc_required_repair','mc_approval_pct',r.mc_approval_pct,'mc_total',r.mc_total,'mc_approved',r.mc_approved)
          ) RETURNING id INTO v_job_id;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.auto_heal_log (action_type,target_id,target_type,result_status,metadata)
    VALUES ('soft_drift_mc_required_repair', r.package_id, 'package',
      CASE WHEN p_dry_run THEN 'dry_run' WHEN v_action IS NOT NULL THEN 'enqueued' ELSE 'skipped' END,
      jsonb_build_object('package_id',r.package_id,'package_title',r.package_title,'track',r.track,
        'mc_total',r.mc_total,'mc_approved',r.mc_approved,'mc_approval_pct',r.mc_approval_pct,
        'risk_score',r.risk_score,'dry_run',p_dry_run,'action',v_action,'job_id',v_job_id,'skip_reason',v_skip_reason));

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'package_id',r.package_id,'package_title',r.package_title,'track',r.track,
      'mc_approval_pct',r.mc_approval_pct,'action',v_action,'job_id',v_job_id,'skip_reason',v_skip_reason));
  END LOOP;

  RETURN jsonb_build_object('ok',true,'dry_run',p_dry_run,
    'required_tracks',to_jsonb(v_required_tracks),
    'count',jsonb_array_length(v_results),'results',v_results);
END;$$;