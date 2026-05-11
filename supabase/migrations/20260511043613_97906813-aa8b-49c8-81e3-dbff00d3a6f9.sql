
CREATE OR REPLACE FUNCTION public.admin_heal_phantom_building_packages(
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 200
)
RETURNS TABLE (
  package_id uuid,
  package_key text,
  action text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count  int  := 0;
  v_skipped int := 0;
  v_rec    record;
  v_prot   jsonb;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  PERFORM set_config('app.transition_source', 'admin_heal_phantom_building_packages', true);

  FOR v_rec IN
    SELECT v.package_id, v.package_key, v.bronze_locked, v.last_active_job_at, v.build_progress, v.approved_questions, v.package_updated_at
    FROM public.v_phantom_building_packages v
    ORDER BY v.package_updated_at ASC
    LIMIT p_limit
  LOOP
    IF v_rec.bronze_locked THEN
      package_id := v_rec.package_id; package_key := v_rec.package_key;
      action := 'skip'; reason := 'bronze_locked';
      v_skipped := v_skipped + 1; RETURN NEXT; CONTINUE;
    END IF;

    v_prot := public.fn_package_demote_protected(v_rec.package_id);
    IF COALESCE((v_prot->>'protected')::bool, false) THEN
      package_id := v_rec.package_id; package_key := v_rec.package_key;
      action := 'skip';
      reason := 'demote_protected:' || COALESCE(v_prot->>'reason','unknown');
      v_skipped := v_skipped + 1; RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := v_rec.package_id; package_key := v_rec.package_key;
      action := 'would_demote';
      reason := format('progress=%s approved=%s', v_rec.build_progress, v_rec.approved_questions);
      RETURN NEXT; CONTINUE;
    END IF;

    BEGIN
      UPDATE public.course_packages
         SET status='queued', updated_at=now()
       WHERE id = v_rec.package_id AND status='building';

      INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_building_demote','package',v_rec.package_id::text,'success',
        jsonb_build_object(
          'package_key', v_rec.package_key,
          'last_active_job_at', v_rec.last_active_job_at,
          'build_progress', v_rec.build_progress,
          'approved_questions', v_rec.approved_questions,
          'transition_source','admin_heal_phantom_building_packages'
        ));

      v_count := v_count + 1;
      package_id := v_rec.package_id; package_key := v_rec.package_key;
      action := 'demoted'; reason := 'phantom_building_no_lease_no_jobs_6h';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := v_rec.package_id; package_key := v_rec.package_key;
      action := 'error'; reason := SQLERRM;
      v_skipped := v_skipped + 1; RETURN NEXT;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('phantom_building_heal_run','system',
    CASE WHEN v_count>0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object('demoted_count',v_count,'skipped_count',v_skipped,'dry_run',p_dry_run,'limit',p_limit));
END $$;
