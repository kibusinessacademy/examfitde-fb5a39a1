
CREATE OR REPLACE FUNCTION public.fn_guard_autoheal_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src text;
  v_step_key text;
  v_dup record;
  v_autoheal_pattern text := '(autoheal|bronze_targeted_repair|content_repair|oral_autoheal|targeted_deficiency_heal)';
BEGIN
  IF NEW.status NOT IN ('pending','queued') THEN
    RETURN NEW;
  END IF;
  v_src := COALESCE(NEW.payload->>'enqueue_source','');
  IF v_src !~* v_autoheal_pattern THEN
    RETURN NEW;
  END IF;

  v_step_key := COALESCE(NEW.payload->>'step_key', NEW.payload->>'step', NEW.payload->>'target_step', '');

  SELECT id, status, created_at, payload->>'enqueue_source' AS src
    INTO v_dup
    FROM public.job_queue
   WHERE job_type = NEW.job_type
     AND package_id IS NOT DISTINCT FROM NEW.package_id
     AND status IN ('pending','queued','processing')
     AND COALESCE(payload->>'step_key', payload->>'step', payload->>'target_step', '') = v_step_key
     AND created_at > now() - interval '5 minutes'
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'autoheal_duplicate_blocked','fn_guard_autoheal_duplicate','package',COALESCE(NEW.package_id::text,'null'),
      'rejected',
      'Blocked autoheal duplicate of '||NEW.job_type||' (existing job '||v_dup.id||' status='||v_dup.status||')',
      jsonb_build_object('job_type',NEW.job_type,'package_id',NEW.package_id,'step_key',v_step_key,
        'enqueue_source',v_src,'existing_job_id',v_dup.id,'existing_status',v_dup.status,
        'existing_source',v_dup.src,'pattern','autoheal_dedup_v1')
    );
    RAISE EXCEPTION 'AUTOHEAL_DUPLICATE_BLOCKED: % already active for package % (job %, src %)',
      NEW.job_type, NEW.package_id, v_dup.id, v_dup.src
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_autoheal_duplicate ON public.job_queue;
CREATE TRIGGER trg_guard_autoheal_duplicate
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_autoheal_duplicate();

-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_content_repair_workflow(
  p_package_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class record;
  v_curriculum uuid;
  v_track text;
  v_actions jsonb := '[]'::jsonb;
  v_codes text[];
  v_payload jsonb;
  v_res record;
  v_idx int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'admin_content_repair_workflow: forbidden';
  END IF;

  SELECT vc.*, c.curriculum_id AS _curriculum_id INTO v_class
    FROM public.v_package_release_classification vc
    LEFT JOIN public.course_packages cp ON cp.id = vc.package_id
    LEFT JOIN public.courses c ON c.id = cp.course_id
   WHERE vc.package_id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','no_classification','package_id',p_package_id);
  END IF;

  v_curriculum := v_class._curriculum_id;
  v_track := v_class.track;
  v_codes := v_class.deficiency_codes;

  IF 'NO_HANDBOOK' = ANY(v_codes) AND v_class.track_needs_handbook THEN
    v_payload := jsonb_build_object('package_id',p_package_id,'curriculum_id',v_curriculum,
      'enqueue_source','content_repair_workflow_v1','step_key','generate_handbook','reason','NO_HANDBOOK');
    IF NOT p_dry_run THEN
      SELECT * INTO v_res FROM public.enqueue_job_if_absent('package_generate_handbook', p_package_id, 50, 5, NULL, v_payload);
    END IF;
    v_idx := v_idx + 1;
    v_actions := v_actions || jsonb_build_object('order',v_idx,'job_type','package_generate_handbook','reason','NO_HANDBOOK','enqueued', NOT p_dry_run);
  END IF;

  IF 'NO_TUTOR' = ANY(v_codes) AND v_class.track_needs_tutor THEN
    v_payload := jsonb_build_object('package_id',p_package_id,'curriculum_id',v_curriculum,
      'enqueue_source','content_repair_workflow_v1','step_key','build_ai_tutor_index','reason','NO_TUTOR');
    IF NOT p_dry_run THEN
      SELECT * INTO v_res FROM public.enqueue_job_if_absent('package_build_ai_tutor_index', p_package_id, 60, 5, NULL, v_payload);
    END IF;
    v_idx := v_idx + 1;
    v_actions := v_actions || jsonb_build_object('order',v_idx,'job_type','package_build_ai_tutor_index','reason','NO_TUTOR','enqueued', NOT p_dry_run);
  END IF;

  IF 'NO_ORAL' = ANY(v_codes) AND v_class.track_needs_oral THEN
    v_payload := jsonb_build_object('package_id',p_package_id,'curriculum_id',v_curriculum,
      'enqueue_source','content_repair_workflow_v1','step_key','generate_oral_exam','reason','NO_ORAL');
    IF NOT p_dry_run THEN
      SELECT * INTO v_res FROM public.enqueue_job_if_absent('package_generate_oral_exam', p_package_id, 70, 5, NULL, v_payload);
    END IF;
    v_idx := v_idx + 1;
    v_actions := v_actions || jsonb_build_object('order',v_idx,'job_type','package_generate_oral_exam','reason','NO_ORAL','enqueued', NOT p_dry_run);
  END IF;

  IF 'LF_COVERAGE_GAP' = ANY(v_codes) THEN
    v_payload := jsonb_build_object('package_id',p_package_id,'curriculum_id',v_curriculum,
      'enqueue_source','content_repair_workflow_v1','step_key','generate_exam_pool',
      'is_repair',true,'mode','lf_coverage','reason','LF_COVERAGE_GAP');
    IF NOT p_dry_run THEN
      SELECT * INTO v_res FROM public.enqueue_job_if_absent('package_repair_exam_pool_lf_coverage', p_package_id, 80, 5, NULL, v_payload);
    END IF;
    v_idx := v_idx + 1;
    v_actions := v_actions || jsonb_build_object('order',v_idx,'job_type','package_repair_exam_pool_lf_coverage','reason','LF_COVERAGE_GAP','enqueued', NOT p_dry_run);
  END IF;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'content_repair_workflow_run','admin_content_repair_workflow','package',p_package_id::text,
    CASE WHEN v_idx = 0 THEN 'noop' ELSE 'ok' END,
    'Planned '||v_idx||' repair jobs for codes '||COALESCE(array_to_string(v_codes,','),'(none)'),
    jsonb_build_object('package_id',p_package_id,'release_class',v_class.release_class,
      'deficiency_codes',v_codes,'track',v_track,'dry_run',p_dry_run,'actions',v_actions)
  );

  RETURN jsonb_build_object('status','ok','package_id',p_package_id,'release_class',v_class.release_class,
    'deficiency_codes',v_codes,'planned',v_idx,'dry_run',p_dry_run,'actions',v_actions);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_content_repair_workflow(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_content_repair_workflow(uuid, boolean) TO authenticated, service_role;
