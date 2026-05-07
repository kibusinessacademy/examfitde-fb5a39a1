-- ============================================================
-- Forensik + Heal: NO_INDEX_FOUND tutor_index
-- Eine Migration, ein Concern: Detection-View + Heal-RPC.
-- ============================================================

-- 1) Detection: betroffene Pakete + Eligibility-Klassifikation
CREATE OR REPLACE VIEW public.v_tutor_index_no_index_forensics AS
WITH affected AS (
  SELECT DISTINCT package_id
  FROM public.job_queue
  WHERE status='failed'
    AND updated_at > now() - interval '24 hours'
    AND last_error LIKE '%NO_INDEX_FOUND%'
    AND package_id IS NOT NULL
)
SELECT
  a.package_id,
  p.status AS pkg_status,
  p.gate_class,
  (SELECT status::text FROM public.package_steps
    WHERE package_id=a.package_id AND step_key='build_ai_tutor_index') AS build_step_status,
  (SELECT status::text FROM public.package_steps
    WHERE package_id=a.package_id AND step_key='validate_tutor_index') AS validate_step_status,
  (SELECT COUNT(*) FROM public.job_queue
    WHERE package_id=a.package_id
      AND status IN ('pending','processing','queued')
      AND job_type IN ('package_build_ai_tutor_index','package_validate_tutor_index')) AS active_tutor_jobs,
  (SELECT COUNT(*) FROM public.ai_tutor_context_index
    WHERE package_id=a.package_id) AS index_rows,
  (SELECT COUNT(*) FROM public.exam_questions
    WHERE package_id=a.package_id AND status='approved') AS approved_questions,
  CASE
    WHEN (SELECT COUNT(*) FROM public.job_queue
          WHERE package_id=a.package_id
            AND status IN ('pending','processing','queued')
            AND job_type IN ('package_build_ai_tutor_index','package_validate_tutor_index')) > 0
      THEN 'defer_active_jobs'
    WHEN (SELECT COUNT(*) FROM public.ai_tutor_context_index
          WHERE package_id=a.package_id) > 0
      THEN 'defer_index_present_revalidate'
    WHEN (SELECT COUNT(*) FROM public.exam_questions
          WHERE package_id=a.package_id AND status='approved') < 50
      THEN 'defer_no_artifacts'
    ELSE 'eligible_build_missing'
  END AS eligibility
FROM affected a
JOIN public.course_packages p ON p.id = a.package_id;

REVOKE ALL ON public.v_tutor_index_no_index_forensics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tutor_index_no_index_forensics TO service_role;

-- 2) Read-only RPC für Forensik (admin-gated)
CREATE OR REPLACE FUNCTION public.admin_get_tutor_index_no_index_forensics()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_items jsonb;
  v_summary jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role)
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.package_id), '[]'::jsonb)
    INTO v_items
  FROM public.v_tutor_index_no_index_forensics v;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'eligible_build_missing', COUNT(*) FILTER (WHERE eligibility='eligible_build_missing'),
    'defer_active_jobs', COUNT(*) FILTER (WHERE eligibility='defer_active_jobs'),
    'defer_index_present_revalidate', COUNT(*) FILTER (WHERE eligibility='defer_index_present_revalidate'),
    'defer_no_artifacts', COUNT(*) FILTER (WHERE eligibility='defer_no_artifacts')
  ) INTO v_summary
  FROM public.v_tutor_index_no_index_forensics;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'summary', v_summary,
    'items', v_items
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_tutor_index_no_index_forensics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_tutor_index_no_index_forensics() TO authenticated, service_role;

-- 3) Heal-RPC: nudgt build_ai_tutor_index queued + enqueued Job (eligible only)
CREATE OR REPLACE FUNCTION public.admin_heal_tutor_index_missing_build(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
  v_eligible int := 0;
  v_jobs_enqueued int := 0;
  v_steps_nudged int := 0;
  v_skipped int := 0;
  v_actions jsonb := '[]'::jsonb;
  v_job_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role)
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  FOR r IN
    SELECT * FROM public.v_tutor_index_no_index_forensics
    WHERE eligibility = 'eligible_build_missing'
  LOOP
    v_eligible := v_eligible + 1;

    IF p_dry_run THEN
      v_actions := v_actions || jsonb_build_object(
        'package_id', r.package_id,
        'action', 'would_enqueue_build_ai_tutor_index',
        'build_step_status', r.build_step_status,
        'approved', r.approved_questions
      );
      CONTINUE;
    END IF;

    -- Step nudgen: skipped/queued -> queued + clear debounce
    UPDATE public.package_steps
       SET status = 'queued'::package_step_status,
           meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at',
           updated_at = now()
     WHERE package_id = r.package_id
       AND step_key = 'build_ai_tutor_index';
    v_steps_nudged := v_steps_nudged + 1;

    -- Job enqueuen (idempotent via key)
    BEGIN
      INSERT INTO public.job_queue (job_type, package_id, status, priority, payload, meta, enqueue_source, idempotency_key)
      VALUES (
        'package_build_ai_tutor_index',
        r.package_id,
        'queued',
        6,
        jsonb_build_object(
          'package_id', r.package_id,
          'enqueue_source', 'tutor_index_no_index_heal',
          'origin_validate_failed', true
        ),
        jsonb_build_object('tutor_index_heal', true, 'origin', 'no_index_found'),
        'tutor_index_no_index_heal',
        'tutor_index_heal:'||r.package_id::text||':'||to_char(now(),'YYYYMMDDHH24')
      )
      RETURNING id INTO v_job_id;
      v_jobs_enqueued := v_jobs_enqueued + 1;

      v_actions := v_actions || jsonb_build_object(
        'package_id', r.package_id,
        'action', 'enqueued_build_ai_tutor_index',
        'job_id', v_job_id
      );
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
      v_actions := v_actions || jsonb_build_object(
        'package_id', r.package_id,
        'action', 'skipped_idempotency_collision'
      );
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'tutor_index_no_index_heal',
    'system',
    NULL,
    CASE WHEN v_eligible=0 THEN 'noop'
         WHEN p_dry_run THEN 'dry_run'
         ELSE 'success' END,
    format('eligible=%s enqueued=%s nudged=%s skipped=%s dry_run=%s',
           v_eligible, v_jobs_enqueued, v_steps_nudged, v_skipped, p_dry_run),
    jsonb_build_object(
      'eligible', v_eligible,
      'jobs_enqueued', v_jobs_enqueued,
      'steps_nudged', v_steps_nudged,
      'skipped', v_skipped,
      'dry_run', p_dry_run,
      'actions', v_actions
    )
  );

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'eligible', v_eligible,
    'jobs_enqueued', v_jobs_enqueued,
    'steps_nudged', v_steps_nudged,
    'skipped', v_skipped,
    'actions', v_actions
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_heal_tutor_index_missing_build(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_tutor_index_missing_build(boolean) TO authenticated, service_role;

-- ROLLBACK-HINT:
-- DROP FUNCTION IF EXISTS public.admin_heal_tutor_index_missing_build(boolean);
-- DROP FUNCTION IF EXISTS public.admin_get_tutor_index_no_index_forensics();
-- DROP VIEW IF EXISTS public.v_tutor_index_no_index_forensics;
--
-- SMOKE:
-- SELECT public.admin_heal_tutor_index_missing_build(true);  -- dry-run
-- SELECT public.admin_get_tutor_index_no_index_forensics();