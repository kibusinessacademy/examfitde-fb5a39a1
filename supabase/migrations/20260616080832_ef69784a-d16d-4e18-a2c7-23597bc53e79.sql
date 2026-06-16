
CREATE OR REPLACE FUNCTION public.admin_apply_quality_intelligence_recommendation(p_recommendation_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rec           public.quality_intelligence_recommendations%ROWTYPE;
  v_uid           uuid := auth.uid();
  v_is_admin      boolean := (v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::app_role));
  v_is_service    boolean := (current_setting('request.jwt.claim.role', true) = 'service_role') OR (current_user = 'service_role');
  v_action text; v_job_type text; v_payload_pkg uuid; v_targets uuid[]; v_target uuid;
  v_curriculum_id uuid; v_idem text; v_existing uuid; v_job_id uuid; v_first_job uuid;
  v_enqueued int := 0; v_reused int := 0; v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_allowed text[] := ARRAY['expand_question_pool','enqueue_coverage_repair','enqueue_integrity_check'];
BEGIN
  IF NOT (v_is_admin OR v_is_service) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_rec FROM public.quality_intelligence_recommendations WHERE id = p_recommendation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recommendation_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_rec.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_APPROVED', 'current_status', v_rec.status);
  END IF;

  v_action := v_rec.action_kind;
  IF NOT (v_action = ANY (v_allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'ACTION_NOT_ALLOWED', 'action_kind', v_action);
  END IF;

  v_job_type := CASE v_action
    WHEN 'expand_question_pool'    THEN 'package_generate_exam_pool'
    WHEN 'enqueue_coverage_repair' THEN COALESCE(NULLIF(v_rec.proposed_payload->>'coverage_kind',''), 'package_repair_exam_pool_competency_coverage')
    WHEN 'enqueue_integrity_check' THEN 'package_run_integrity_check'
  END;

  IF v_action = 'enqueue_coverage_repair'
     AND v_job_type NOT IN ('package_repair_exam_pool_competency_coverage','package_repair_exam_pool_lf_coverage') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'INVALID_COVERAGE_KIND', 'value', v_job_type);
  END IF;

  v_payload_pkg := NULLIF(v_rec.proposed_payload->>'package_id','')::uuid;
  IF v_payload_pkg IS NOT NULL THEN
    v_targets := ARRAY[v_payload_pkg];
  ELSIF jsonb_typeof(v_rec.target_ids) = 'array' AND jsonb_array_length(v_rec.target_ids) > 0 THEN
    SELECT array_agg(NULLIF(x,'')::uuid) INTO v_targets
      FROM jsonb_array_elements_text(v_rec.target_ids) AS x WHERE NULLIF(x,'') IS NOT NULL;
  END IF;
  IF v_targets IS NULL OR array_length(v_targets,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'MISSING_PACKAGE_ID');
  END IF;

  FOREACH v_target IN ARRAY v_targets LOOP
    SELECT curriculum_id INTO v_curriculum_id FROM public.course_packages WHERE id = v_target;
    IF v_curriculum_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_target, 'status', 'skipped',
        'reason', CASE WHEN NOT EXISTS (SELECT 1 FROM public.course_packages WHERE id=v_target)
                       THEN 'PACKAGE_NOT_FOUND' ELSE 'MISSING_CURRICULUM_ID' END);
      CONTINUE;
    END IF;

    v_idem := format('quality_intelligence:%s:%s:%s', p_recommendation_id, v_action, v_target);
    SELECT id INTO v_existing FROM public.job_queue WHERE idempotency_key = v_idem LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_reused := v_reused + 1;
      v_first_job := COALESCE(v_first_job, v_existing);
      v_results := v_results || jsonb_build_object('package_id', v_target, 'status', 'already_enqueued', 'job_id', v_existing);
      CONTINUE;
    END IF;

    INSERT INTO public.job_queue (
      job_type, status, payload, priority, idempotency_key, package_id,
      job_name, correlation_id, meta
    ) VALUES (
      v_job_type, 'pending',
      jsonb_build_object('package_id', v_target, 'curriculum_id', v_curriculum_id,
                         'source','quality_intelligence','recommendation_id', p_recommendation_id),
      20, v_idem, v_target, 'qil_apply_' || v_action, p_recommendation_id,
      jsonb_build_object('source','quality_intelligence_1a','recommendation_id', p_recommendation_id,
                         'action_kind', v_action, 'curriculum_id', v_curriculum_id,
                         'approved_by', COALESCE(v_uid::text,'service_role'))
    ) RETURNING id INTO v_job_id;

    v_enqueued := v_enqueued + 1;
    v_first_job := COALESCE(v_first_job, v_job_id);
    v_results := v_results || jsonb_build_object('package_id', v_target, 'status', 'enqueued', 'job_id', v_job_id);
  END LOOP;

  -- enqueued (not 'applied') — matches status check constraint
  UPDATE public.quality_intelligence_recommendations
     SET status = CASE WHEN v_enqueued > 0 OR v_reused > 0 THEN 'enqueued' ELSE status END,
         enqueued_job_id = v_first_job,
         updated_at = now()
   WHERE id = p_recommendation_id;

  RETURN jsonb_build_object('ok', true, 'recommendation_id', p_recommendation_id,
    'action_kind', v_action, 'job_type', v_job_type,
    'enqueued', v_enqueued, 'reused', v_reused, 'skipped', v_skipped,
    'first_job_id', v_first_job, 'results', v_results);
END;
$function$;
