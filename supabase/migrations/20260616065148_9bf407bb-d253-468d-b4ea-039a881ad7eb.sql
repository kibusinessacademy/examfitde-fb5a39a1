
-- Allow admins to update recommendations (approve/reject/decision_note)
DROP POLICY IF EXISTS qir_admin_update ON public.quality_intelligence_recommendations;
CREATE POLICY qir_admin_update ON public.quality_intelligence_recommendations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- KIMI.INTELLIGENCE.1a: Apply bridge (strict allowlist, idempotent, audited)
CREATE OR REPLACE FUNCTION public.admin_apply_quality_intelligence_recommendation(
  p_recommendation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec           public.quality_intelligence_recommendations%ROWTYPE;
  v_uid           uuid := auth.uid();
  v_action        text;
  v_job_type      text;
  v_target_pkg    uuid;
  v_payload       jsonb;
  v_idem          text;
  v_existing_job  uuid;
  v_job_id        uuid;
  v_allowed       text[] := ARRAY['expand_question_pool','enqueue_coverage_repair','enqueue_integrity_check'];
BEGIN
  -- AuthZ
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rec
  FROM public.quality_intelligence_recommendations
  WHERE id = p_recommendation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recommendation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_rec.status <> 'approved' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason_code', 'NOT_APPROVED',
      'current_status', v_rec.status
    );
  END IF;

  v_action := v_rec.action_kind;
  IF NOT (v_action = ANY (v_allowed)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason_code', 'ACTION_NOT_ALLOWED',
      'action_kind', v_action,
      'allowed', to_jsonb(v_allowed)
    );
  END IF;

  -- Target package id: prefer proposed_payload.package_id, else first target_ids entry
  v_target_pkg := NULLIF(v_rec.proposed_payload->>'package_id','')::uuid;
  IF v_target_pkg IS NULL AND jsonb_typeof(v_rec.target_ids) = 'array' AND jsonb_array_length(v_rec.target_ids) > 0 THEN
    v_target_pkg := NULLIF(v_rec.target_ids->>0,'')::uuid;
  END IF;

  IF v_target_pkg IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'MISSING_PACKAGE_ID');
  END IF;

  -- Map action_kind -> existing job_type (strict)
  v_job_type := CASE v_action
    WHEN 'expand_question_pool'      THEN 'package_generate_exam_pool'
    WHEN 'enqueue_coverage_repair'   THEN COALESCE(NULLIF(v_rec.proposed_payload->>'coverage_kind',''), 'package_repair_exam_pool_competency_coverage')
    WHEN 'enqueue_integrity_check'   THEN 'package_run_integrity_check'
  END;

  -- Whitelist coverage_kind values
  IF v_action = 'enqueue_coverage_repair'
     AND v_job_type NOT IN ('package_repair_exam_pool_competency_coverage','package_repair_exam_pool_lf_coverage') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'INVALID_COVERAGE_KIND', 'value', v_job_type);
  END IF;

  -- Idempotency
  v_idem := format('quality_intelligence:%s:%s:%s', p_recommendation_id, v_action, v_target_pkg);

  SELECT id INTO v_existing_job
  FROM public.job_queue
  WHERE idempotency_key = v_idem
  LIMIT 1;

  IF v_existing_job IS NOT NULL THEN
    UPDATE public.quality_intelligence_recommendations
       SET status = 'enqueued',
           enqueued_job_id = v_existing_job,
           updated_at = now()
     WHERE id = p_recommendation_id
       AND status <> 'enqueued';

    RETURN jsonb_build_object(
      'ok', true,
      'reason_code', 'ALREADY_ENQUEUED',
      'job_id', v_existing_job,
      'idempotency_key', v_idem
    );
  END IF;

  -- Payload (minimal, additional fields preserved under meta.source)
  v_payload := jsonb_build_object(
    'package_id', v_target_pkg,
    'source', 'quality_intelligence',
    'recommendation_id', p_recommendation_id
  );

  INSERT INTO public.job_queue (
    job_type, status, payload, priority, idempotency_key, package_id,
    job_name, correlation_id, meta
  ) VALUES (
    v_job_type,
    'pending',
    v_payload,
    20,
    v_idem,
    v_target_pkg,
    'qil_apply_' || v_action,
    p_recommendation_id,
    jsonb_build_object(
      'source', 'quality_intelligence_1a',
      'recommendation_id', p_recommendation_id,
      'action_kind', v_action,
      'approved_by', v_uid
    )
  )
  RETURNING id INTO v_job_id;

  UPDATE public.quality_intelligence_recommendations
     SET status = 'enqueued',
         enqueued_job_id = v_job_id,
         decided_by = COALESCE(decided_by, v_uid),
         decided_at = COALESCE(decided_at, now()),
         updated_at = now()
   WHERE id = p_recommendation_id;

  -- Audit (SSOT)
  BEGIN
    PERFORM public.fn_emit_audit(
      'qil_recommendation_applied',
      jsonb_build_object(
        'recommendation_id', p_recommendation_id,
        'action_kind', v_action,
        'job_type', v_job_type,
        'job_id', v_job_id,
        'package_id', v_target_pkg,
        'idempotency_key', v_idem,
        'actor', v_uid
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit best-effort; do not fail user action
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'reason_code', 'ENQUEUED',
    'job_id', v_job_id,
    'job_type', v_job_type,
    'package_id', v_target_pkg,
    'idempotency_key', v_idem
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_quality_intelligence_recommendation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_quality_intelligence_recommendation(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_apply_quality_intelligence_recommendation(uuid) IS
'KIMI.INTELLIGENCE.1a Apply-Bridge. Strict allowlist (expand_question_pool, enqueue_coverage_repair, enqueue_integrity_check). Idempotent. Audited. No writes to exam_questions/course_packages/council_*.';
