-- 20260501_stop_council_defer_loop.sql
BEGIN;

-- 1) BEFORE INSERT trigger: block package_quality_council jobs while active council defer exists
CREATE OR REPLACE FUNCTION public.fn_block_council_jobs_while_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_has_defer boolean;
BEGIN
  IF NEW.job_type <> 'package_quality_council' THEN
    RETURN NEW;
  END IF;

  v_package_id := COALESCE(
    NULLIF(NEW.payload->>'package_id','')::uuid,
    NEW.package_id
  );

  IF v_package_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.council_defer_log c
    WHERE c.package_id = v_package_id
      AND c.cleared_at IS NULL
  ) INTO v_has_defer;

  IF NOT v_has_defer THEN
    RETURN NEW;
  END IF;

  -- Bypass for explicit admin resume (mark via payload.source)
  IF COALESCE(NEW.payload->>'source','') = 'admin_resolve_council_deferred' THEN
    RETURN NEW;
  END IF;

  NEW.status := 'cancelled';
  NEW.last_error := 'package_quality_council blocked: council_defer_log active';
  NEW.meta := COALESCE(NEW.meta, '{}'::jsonb)
    || jsonb_build_object(
      'cancel_reason', 'BLOCKED_BY_ACTIVE_COUNCIL_DEFER',
      'blocked_by', 'council_defer_log',
      'blocked_at', now(),
      'guard', 'fn_block_council_jobs_while_deferred'
    );

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, metadata)
  VALUES (
    'blocked_council_job_while_deferred',
    v_package_id::text,
    'package',
    'blocked',
    jsonb_build_object('job_type', NEW.job_type, 'reason', 'active_council_defer', 'created_at', now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_council_jobs_while_deferred ON public.job_queue;
CREATE TRIGGER trg_block_council_jobs_while_deferred
BEFORE INSERT ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_block_council_jobs_while_deferred();


-- 2) Safe resolver for active council defers
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
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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

REVOKE ALL ON FUNCTION public.admin_resolve_council_deferred(uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_council_deferred(uuid[], text, text) TO service_role, authenticated;

COMMIT;