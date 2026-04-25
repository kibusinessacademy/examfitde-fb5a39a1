
CREATE OR REPLACE FUNCTION public.fn_autofix_exam_pool_deficit(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diag         jsonb;
  v_action       text;
  v_curriculum   uuid;
  v_safe         boolean;
  v_promoted     int := 0;
  v_skipped      int := 0;
  v_enqueued_jobs jsonb := '[]'::jsonb;
  v_target       int;
  v_track        text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND current_setting('role') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_diag := public.fn_diagnose_exam_pool_deficit(p_package_id);
  IF (v_diag->>'ok')::boolean IS NOT TRUE THEN
    RETURN v_diag;
  END IF;

  v_action     := v_diag->'recommended_fix'->>'action';
  v_safe       := COALESCE((v_diag->'recommended_fix'->>'safe')::boolean, false);
  v_curriculum := (v_diag->'package'->>'curriculum_id')::uuid;
  v_track      := v_diag->'package'->>'track';

  IF NOT v_safe THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unsafe_action_requires_manual_review',
      'diagnosis', v_diag
    );
  END IF;

  IF v_action IN ('promote_tier1','promote_then_generate') THEN
    SELECT promoted_count, skipped_count
      INTO v_promoted, v_skipped
    FROM public.fn_promote_eligible_tier1_to_approved(v_curriculum);
  END IF;

  IF v_action IN ('promote_then_generate','enqueue_generate_exam_pool') THEN
    v_target := COALESCE((v_diag->'recommended_fix'->>'exam_target')::int, 700);
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta, created_at, updated_at)
    VALUES (
      'package_generate_exam_pool',
      p_package_id,
      'pending', 5, 3,
      jsonb_build_object('package_id', p_package_id, 'curriculum_id', v_curriculum, 'exam_target', v_target),
      jsonb_build_object('enqueued_by', 'fn_autofix_exam_pool_deficit', 'reason', 'auto_fix_too_few_approved', 'exam_target', v_target, 'track', v_track),
      now(), now()
    );
    v_enqueued_jobs := v_enqueued_jobs || jsonb_build_object('job_type', 'package_generate_exam_pool', 'exam_target', v_target);
  END IF;

  IF v_action = 'enqueue_lf_gap_fill' THEN
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta, created_at, updated_at)
    VALUES (
      'pool_fill_lf_gaps',
      p_package_id,
      'pending', 5, 3,
      jsonb_build_object('package_id', p_package_id, 'curriculum_id', v_curriculum),
      jsonb_build_object('enqueued_by', 'fn_autofix_exam_pool_deficit', 'reason', 'auto_fix_lf_coverage_gap'),
      now(), now()
    );
    v_enqueued_jobs := v_enqueued_jobs || jsonb_build_object('job_type', 'pool_fill_lf_gaps');
  END IF;

  -- Audit-Log mit korrektem Schema
  INSERT INTO public.admin_notifications (category, severity, title, body, entity_type, entity_id, metadata, created_at)
  VALUES (
    'exam_pool_autofix',
    'info',
    format('Auto-Fix angewendet: %s', v_diag->'package'->>'title'),
    format('Root-Cause: %s | Promoted: %s | Jobs: %s',
      v_diag->'root_cause'->>'code', v_promoted, jsonb_array_length(v_enqueued_jobs)),
    'package',
    p_package_id,
    jsonb_build_object(
      'diagnosis', v_diag,
      'promoted', v_promoted,
      'skipped', v_skipped,
      'enqueued', v_enqueued_jobs
    ),
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action_taken', v_action,
    'promoted_count', v_promoted,
    'skipped_count', v_skipped,
    'enqueued_jobs', v_enqueued_jobs,
    'diagnosis', v_diag,
    'applied_at', now()
  );
END;
$$;
