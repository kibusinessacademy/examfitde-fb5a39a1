CREATE OR REPLACE FUNCTION public.admin_publish_handbook_remaining(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curr uuid; v_track text; v_status text;
  v_total int := 0; v_already int := 0; v_published int := 0; v_skipped int := 0;
  v_chapter_ids uuid[];
BEGIN
  IF current_user NOT IN ('service_role','postgres')
     AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;

  SELECT cp.curriculum_id, cp.track, cp.status INTO v_curr, v_track, v_status
  FROM public.course_packages cp WHERE cp.id = p_package_id;
  IF v_curr IS NULL THEN RAISE EXCEPTION 'package % not found / no curriculum_id', p_package_id; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_published) INTO v_total, v_already
  FROM public.handbook_chapters WHERE curriculum_id = v_curr;

  WITH cand AS (SELECT hc.id FROM public.handbook_chapters hc
                 WHERE hc.curriculum_id=v_curr AND COALESCE(hc.is_published,false)=false),
       publishable AS (SELECT c.id, public.fn_handbook_chapter_publishable(c.id) AS ok FROM cand c),
       upd AS (UPDATE public.handbook_chapters hc SET is_published=true, updated_at=now()
               WHERE hc.id IN (SELECT id FROM publishable WHERE ok=true)
               RETURNING hc.id)
  SELECT array_agg(id) INTO v_chapter_ids FROM upd;

  v_published := COALESCE(array_length(v_chapter_ids,1),0);
  v_skipped := (v_total - v_already) - v_published;

  INSERT INTO public.auto_heal_log (action_type,target_id,target_type,result_status,metadata)
  VALUES ('soft_drift_handbook_publish_remaining', p_package_id, 'package',
    CASE WHEN v_published>0 THEN 'success' WHEN v_skipped>0 THEN 'noop_not_publishable' ELSE 'noop_complete' END,
    jsonb_build_object('package_id',p_package_id,'curriculum_id',v_curr,'track',v_track,
      'pkg_status',v_status,'chapters_total',v_total,'chapters_already_published',v_already,
      'chapters_published_now',v_published,'chapters_skipped_unpublishable',v_skipped,
      'published_chapter_ids',COALESCE(to_jsonb(v_chapter_ids),'[]'::jsonb),
      'gate_fn','fn_handbook_chapter_publishable'));

  RETURN jsonb_build_object('ok',true,'package_id',p_package_id,
    'chapters_total',v_total,'chapters_already_published',v_already,
    'chapters_published_now',v_published,'chapters_skipped_unpublishable',v_skipped,
    'published_chapter_ids',COALESCE(to_jsonb(v_chapter_ids),'[]'::jsonb));
END;$$;

CREATE OR REPLACE FUNCTION public.admin_soft_drift_mc_repair(p_package_ids uuid[], p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_results jsonb := '[]'::jsonb; r record; v_active int; v_job_id uuid;
  v_action text; v_skip_reason text; v_required_tracks text[] := ARRAY[]::text[];
BEGIN
  IF current_user NOT IN ('service_role','postgres')
     AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;

  SELECT array_agg(track) INTO v_required_tracks FROM public.track_step_applicability
  WHERE step_key='generate_lesson_minichecks' AND should_run=true;

  FOR r IN SELECT v.package_id,v.package_title,v.track,v.mc_total,v.mc_approved,v.mc_approval_pct,v.mc_required,v.risk_score
           FROM public.v_soft_drift_packages_ssot v WHERE v.package_id = ANY(p_package_ids)
  LOOP
    v_action:=NULL; v_skip_reason:=NULL; v_job_id:=NULL;
    IF NOT r.mc_required OR r.track NOT IN (SELECT unnest(v_required_tracks)) THEN
      v_skip_reason:='mc_not_required_for_track';
    ELSIF upper(r.track)='EXAM_FIRST' THEN v_skip_reason:='exam_first_excluded';
    ELSIF r.mc_total=0 THEN v_skip_reason:='no_minichecks';
    ELSIF r.mc_approval_pct IS NULL OR r.mc_approval_pct >= 85 THEN v_skip_reason:='above_threshold';
    ELSE
      SELECT COUNT(*) INTO v_active FROM public.job_queue
      WHERE status IN ('pending','queued','processing','running')
        AND job_type IN ('package_validate_lesson_minichecks','package_generate_lesson_minichecks')
        AND (payload->>'package_id')::uuid = r.package_id;
      IF v_active>0 THEN v_skip_reason:='active_jobs_exist';
      ELSE
        v_action:='package_validate_lesson_minichecks';
        IF NOT p_dry_run THEN
          INSERT INTO public.job_queue (job_type,payload,status,priority,max_attempts,scheduled_for,metadata)
          VALUES (v_action,
            jsonb_build_object('package_id',r.package_id,'enqueue_source','soft_drift_mc_required_repair','reason','mc_approval_pct_below_85'),
            'queued',50,3,now(),
            jsonb_build_object('enqueue_source','soft_drift_mc_required_repair','mc_approval_pct',r.mc_approval_pct,'mc_total',r.mc_total,'mc_approved',r.mc_approved))
          RETURNING id INTO v_job_id;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.auto_heal_log (action_type,target_id,target_type,result_status,metadata)
    VALUES ('soft_drift_mc_required_repair', r.package_id, 'package',
      CASE WHEN p_dry_run THEN 'dry_run' WHEN v_action IS NOT NULL THEN 'enqueued' ELSE 'skipped' END,
      jsonb_build_object('package_id',r.package_id,'package_title',r.package_title,'track',r.track,
        'mc_total',r.mc_total,'mc_approved',r.mc_approved,'mc_approval_pct',r.mc_approval_pct,
        'risk_score',r.risk_score,'dry_run',p_dry_run,'action',v_action,'job_id',v_job_id,
        'skip_reason',v_skip_reason));

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'package_id',r.package_id,'package_title',r.package_title,'track',r.track,
      'mc_approval_pct',r.mc_approval_pct,'action',v_action,'job_id',v_job_id,'skip_reason',v_skip_reason));
  END LOOP;

  RETURN jsonb_build_object('ok',true,'dry_run',p_dry_run,
    'required_tracks',to_jsonb(v_required_tracks),
    'count',jsonb_array_length(v_results),'results',v_results);
END;$$;