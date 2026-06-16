
-- 1) Apply-RPC: Fan-out across target_ids
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
  v_payload_pkg   uuid;
  v_targets       uuid[];
  v_target        uuid;
  v_idem          text;
  v_existing      uuid;
  v_job_id        uuid;
  v_first_job     uuid;
  v_enqueued      int := 0;
  v_reused        int := 0;
  v_skipped       int := 0;
  v_results       jsonb := '[]'::jsonb;
  v_allowed       text[] := ARRAY['expand_question_pool','enqueue_coverage_repair','enqueue_integrity_check'];
BEGIN
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
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_APPROVED', 'current_status', v_rec.status);
  END IF;

  v_action := v_rec.action_kind;
  IF NOT (v_action = ANY (v_allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'ACTION_NOT_ALLOWED',
                              'action_kind', v_action, 'allowed', to_jsonb(v_allowed));
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

  -- Build target list: payload.package_id wins; else fan out across target_ids
  v_payload_pkg := NULLIF(v_rec.proposed_payload->>'package_id','')::uuid;
  IF v_payload_pkg IS NOT NULL THEN
    v_targets := ARRAY[v_payload_pkg];
  ELSIF jsonb_typeof(v_rec.target_ids) = 'array' AND jsonb_array_length(v_rec.target_ids) > 0 THEN
    SELECT array_agg(NULLIF(x,'')::uuid)
      INTO v_targets
      FROM jsonb_array_elements_text(v_rec.target_ids) AS x
      WHERE NULLIF(x,'') IS NOT NULL;
  END IF;

  IF v_targets IS NULL OR array_length(v_targets,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'MISSING_PACKAGE_ID');
  END IF;

  FOREACH v_target IN ARRAY v_targets
  LOOP
    -- Only fan out to packages that actually exist
    IF NOT EXISTS (SELECT 1 FROM public.course_packages WHERE id = v_target) THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('package_id', v_target, 'status', 'skipped', 'reason', 'PACKAGE_NOT_FOUND');
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
      v_job_type,
      'pending',
      jsonb_build_object(
        'package_id', v_target,
        'source', 'quality_intelligence',
        'recommendation_id', p_recommendation_id
      ),
      20,
      v_idem,
      v_target,
      'qil_apply_' || v_action,
      p_recommendation_id,
      jsonb_build_object(
        'source', 'quality_intelligence_1a',
        'recommendation_id', p_recommendation_id,
        'action_kind', v_action,
        'approved_by', v_uid
      )
    ) RETURNING id INTO v_job_id;

    v_enqueued := v_enqueued + 1;
    v_first_job := COALESCE(v_first_job, v_job_id);
    v_results := v_results || jsonb_build_object('package_id', v_target, 'status', 'enqueued', 'job_id', v_job_id);
  END LOOP;

  UPDATE public.quality_intelligence_recommendations
     SET status = 'enqueued',
         enqueued_job_id = v_first_job,
         decided_by = COALESCE(decided_by, v_uid),
         decided_at = COALESCE(decided_at, now()),
         updated_at = now()
   WHERE id = p_recommendation_id;

  BEGIN
    PERFORM public.fn_emit_audit(
      'qil_recommendation_applied',
      jsonb_build_object(
        'recommendation_id', p_recommendation_id,
        'action_kind', v_action,
        'job_type', v_job_type,
        'enqueued', v_enqueued,
        'reused', v_reused,
        'skipped', v_skipped,
        'targets', v_targets,
        'actor', v_uid
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'reason_code', CASE WHEN v_enqueued > 0 THEN 'ENQUEUED' ELSE 'ALREADY_ENQUEUED' END,
    'enqueued', v_enqueued,
    'reused', v_reused,
    'skipped', v_skipped,
    'first_job_id', v_first_job,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_quality_intelligence_recommendation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_quality_intelligence_recommendation(uuid) TO authenticated, service_role;

-- 2) Repair Conversion view (per-package, per-applied-rec)
CREATE OR REPLACE VIEW public.v_qil_repair_conversion AS
SELECT
  r.id                                          AS recommendation_id,
  r.module,
  r.action_kind,
  r.priority,
  r.decided_at                                  AS applied_at,
  jq.package_id,
  cp.status                                     AS package_status,
  cp.integrity_passed,
  cp.is_published,
  (cp.integrity_passed IS TRUE
   AND COALESCE(cp.status,'') IN ('done','published','ready'))     AS is_publishable,
  jq.id                                         AS job_id,
  jq.status                                     AS job_status,
  jq.completed_at                               AS job_completed_at
FROM public.quality_intelligence_recommendations r
JOIN public.job_queue jq
  ON jq.correlation_id = r.id
LEFT JOIN public.course_packages cp
  ON cp.id = jq.package_id
WHERE r.status IN ('enqueued','done')
  AND jq.meta->>'source' = 'quality_intelligence_1a';

GRANT SELECT ON public.v_qil_repair_conversion TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_qil_repair_conversion_summary AS
SELECT
  COUNT(*)                                                  AS applied_repairs,
  COUNT(*) FILTER (WHERE job_status = 'completed')          AS jobs_completed,
  COUNT(*) FILTER (WHERE job_status IN ('failed','dead'))   AS jobs_failed,
  COUNT(*) FILTER (WHERE is_publishable)                    AS publishable_reached,
  COUNT(*) FILTER (WHERE is_published)                      AS published_reached,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE is_publishable)
    / NULLIF(COUNT(*),0), 1
  )                                                          AS publishable_conversion_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE is_published)
    / NULLIF(COUNT(*),0), 1
  )                                                          AS published_conversion_pct
FROM public.v_qil_repair_conversion;

GRANT SELECT ON public.v_qil_repair_conversion_summary TO authenticated, service_role;

-- 3) Done ⇒ integrity_passed guard (only blocks NEW transitions; legacy rows untouched)
CREATE OR REPLACE FUNCTION public.tg_block_done_without_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'done'
     AND COALESCE(OLD.status,'') <> 'done'
     AND COALESCE(NEW.integrity_passed, false) IS NOT TRUE THEN

    BEGIN
      PERFORM public.fn_emit_audit(
        'qil_guard_block_done_without_integrity',
        jsonb_build_object(
          'package_id', NEW.id,
          'attempted_status', NEW.status,
          'integrity_passed', NEW.integrity_passed,
          'previous_status', OLD.status
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RAISE EXCEPTION 'INVARIANT_VIOLATION: status=done requires integrity_passed=true (package %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_done_without_integrity ON public.course_packages;
CREATE TRIGGER trg_block_done_without_integrity
BEFORE UPDATE OF status ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.tg_block_done_without_integrity();
