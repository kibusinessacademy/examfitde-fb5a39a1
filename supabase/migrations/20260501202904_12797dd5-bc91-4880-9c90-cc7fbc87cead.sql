CREATE OR REPLACE FUNCTION public.admin_resolve_council_deferred(
  p_package_ids uuid[],
  p_mode text DEFAULT 'retry_council',
  p_reason text DEFAULT 'manual_stop_loop_fix'
)
RETURNS TABLE (
  package_id uuid,
  action text,
  job_id uuid,
  note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_curriculum_id uuid;
  v_job_id uuid;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOREACH v_package_id IN ARRAY p_package_ids LOOP

    SELECT cp.curriculum_id
    INTO v_curriculum_id
    FROM public.course_packages cp
    WHERE cp.id = v_package_id;

    IF v_curriculum_id IS NULL THEN
      package_id := v_package_id;
      action := 'skipped';
      job_id := NULL;
      note := 'package_not_found_or_missing_curriculum_id';
      RETURN NEXT;
      CONTINUE;
    END IF;

    UPDATE public.council_defer_log cdl
    SET cleared_at = now(),
        meta = COALESCE(cdl.meta, '{}'::jsonb)
          || jsonb_build_object(
            'cleared_reason', p_reason,
            'resolved_by', 'admin_resolve_council_deferred',
            'resolve_mode', p_mode,
            'resolved_at', now()
          )
    WHERE cdl.package_id = v_package_id
      AND cdl.cleared_at IS NULL;

    IF p_mode = 'retry_council' THEN
      UPDATE public.package_steps ps
      SET status = 'queued'::step_status,
          started_at = NULL,
          finished_at = NULL,
          meta = COALESCE(ps.meta, '{}'::jsonb)
            || jsonb_build_object(
              'manual_resume', true,
              'resume_reason', p_reason,
              'resumed_at', now()
            )
      WHERE ps.package_id = v_package_id
        AND ps.step_key = 'quality_council'
        AND ps.status IN ('failed','skipped','queued','pending_enqueue');

      SELECT jq.id
      INTO v_job_id
      FROM public.job_queue jq
      WHERE jq.job_type = 'package_quality_council'
        AND COALESCE(NULLIF(jq.payload->>'package_id','')::uuid, jq.package_id) = v_package_id
        AND jq.status IN ('pending','queued','processing')
      ORDER BY jq.created_at DESC
      LIMIT 1;

      IF v_job_id IS NULL THEN
        INSERT INTO public.job_queue (
          job_type, status, lane, package_id, payload, created_at, updated_at
        ) VALUES (
          'package_quality_council', 'pending', 'control', v_package_id,
          jsonb_build_object(
            'package_id', v_package_id,
            'curriculum_id', v_curriculum_id,
            'source', 'admin_resolve_council_deferred',
            'reason', p_reason
          ),
          now(), now()
        )
        RETURNING id INTO v_job_id;
      END IF;

      INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, metadata)
      VALUES (
        'resolved_council_deferred_retry',
        v_package_id::text,
        'package',
        'success',
        jsonb_build_object('mode', p_mode, 'job_id', v_job_id, 'reason', p_reason, 'resolved_at', now())
      );

      package_id := v_package_id;
      action := 'retry_council';
      job_id := v_job_id;
      note := 'defer_cleared_and_council_enqueued_or_reused';
      RETURN NEXT;
    ELSE
      package_id := v_package_id;
      action := 'cleared_only';
      job_id := NULL;
      note := 'defer_cleared_without_retry';
      RETURN NEXT;
    END IF;

  END LOOP;
END;
$$;