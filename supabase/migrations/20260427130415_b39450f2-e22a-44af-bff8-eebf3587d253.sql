-- Hotfix Recover Actions: liveness_status NOT NULL, admin_actions has no 'meta' column (use 'payload')

CREATE OR REPLACE FUNCTION public.admin_release_stale_locks(
  p_stale_seconds integer DEFAULT 600,
  p_max_release integer DEFAULT 200,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
  v_released int := 0;
  v_by_type jsonb := '{}'::jsonb;
  v_t text;
  v_n int;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.job_queue
  WHERE status = 'processing'
    AND COALESCE(last_heartbeat_at, started_at, locked_at) < now() - make_interval(secs => p_stale_seconds);

  FOR v_t, v_n IN
    SELECT job_type, COUNT(*)::int
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, started_at, locked_at) < now() - make_interval(secs => p_stale_seconds)
    GROUP BY job_type
    ORDER BY 2 DESC
  LOOP
    v_by_type := v_by_type || jsonb_build_object(v_t, v_n);
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'candidate_count', v_count,
      'by_type', v_by_type,
      'stale_seconds', p_stale_seconds
    );
  END IF;

  PERFORM set_config('app.transition_source', format('admin_ui:release_stale_locks:%s', COALESCE(v_uid::text, 'unknown')), true);

  WITH released AS (
    UPDATE public.job_queue
    SET status = 'pending'::text,
        locked_at = NULL,
        locked_by = NULL,
        last_heartbeat_at = NULL,
        liveness_status = 'healthy',
        started_at = NULL,
        run_after = now() + interval '5 seconds',
        updated_at = now(),
        last_error = COALESCE(last_error, '') ||
                     CASE WHEN last_error IS NULL OR last_error = '' THEN '' ELSE ' | ' END ||
                     format('stale_lock_released_at=%s', now()::text)
    WHERE id IN (
      SELECT id FROM public.job_queue
      WHERE status = 'processing'
        AND COALESCE(last_heartbeat_at, started_at, locked_at) < now() - make_interval(secs => p_stale_seconds)
      ORDER BY COALESCE(last_heartbeat_at, started_at, locked_at) ASC
      LIMIT p_max_release
    )
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_released FROM released;

  INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload)
  VALUES (
    v_uid, 'release_stale_locks', 'job_queue', ARRAY[]::uuid[],
    jsonb_build_object(
      'stale_seconds', p_stale_seconds,
      'max_release', p_max_release,
      'released', v_released,
      'by_type_before', v_by_type
    )
  );

  RETURN jsonb_build_object(
    'dry_run', false,
    'released', v_released,
    'candidate_count', v_count,
    'by_type', v_by_type
  );
END $function$;

CREATE OR REPLACE FUNCTION public.admin_drain_queue_backlog(
  p_min_age_seconds integer DEFAULT 1800,
  p_max_boost integer DEFAULT 100,
  p_target_priority integer DEFAULT 5,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates int := 0;
  v_boosted int := 0;
  v_by_type jsonb := '{}'::jsonb;
  v_t text;
  v_n int;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT COUNT(*) INTO v_candidates
  FROM public.job_queue
  WHERE status = 'pending'
    AND COALESCE(run_after, created_at) < now() - make_interval(secs => p_min_age_seconds)
    AND priority < p_target_priority;

  FOR v_t, v_n IN
    SELECT job_type, COUNT(*)::int
    FROM public.job_queue
    WHERE status = 'pending'
      AND COALESCE(run_after, created_at) < now() - make_interval(secs => p_min_age_seconds)
      AND priority < p_target_priority
    GROUP BY job_type ORDER BY 2 DESC LIMIT 20
  LOOP
    v_by_type := v_by_type || jsonb_build_object(v_t, v_n);
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true, 'candidate_count', v_candidates,
      'by_type', v_by_type, 'min_age_seconds', p_min_age_seconds,
      'target_priority', p_target_priority
    );
  END IF;

  PERFORM set_config('app.transition_source', format('admin_ui:drain_queue_backlog:%s', COALESCE(v_uid::text, 'unknown')), true);

  WITH boosted AS (
    UPDATE public.job_queue
    SET priority = GREATEST(priority, p_target_priority),
        run_after = now(), updated_at = now()
    WHERE id IN (
      SELECT id FROM public.job_queue
      WHERE status = 'pending'
        AND COALESCE(run_after, created_at) < now() - make_interval(secs => p_min_age_seconds)
        AND priority < p_target_priority
      ORDER BY COALESCE(run_after, created_at) ASC
      LIMIT p_max_boost
    )
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_boosted FROM boosted;

  INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload)
  VALUES (
    v_uid, 'drain_queue_backlog', 'job_queue', ARRAY[]::uuid[],
    jsonb_build_object(
      'min_age_seconds', p_min_age_seconds,
      'max_boost', p_max_boost,
      'target_priority', p_target_priority,
      'boosted', v_boosted, 'by_type', v_by_type
    )
  );

  RETURN jsonb_build_object(
    'dry_run', false, 'boosted', v_boosted,
    'candidate_count', v_candidates, 'by_type', v_by_type
  );
END $function$;

CREATE OR REPLACE FUNCTION public.admin_unblock_packages_by_reason(
  p_reason_class text,
  p_max_packages integer DEFAULT 25,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg_ids uuid[];
  v_unblocked int := 0;
  v_steps_reset int := 0;
  v_target_status text;
  v_reset_step text;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF p_reason_class NOT IN ('HARD_FAIL_NO_CURRICULUM','COVERAGE_GAP','NON_BUILDING_BLOCKED','HARD_FAIL_OTHER','AUTO_HEALED_RESIDUE','NO_STEP_HISTORY','OTHER') THEN
    RAISE EXCEPTION 'invalid reason_class: %', p_reason_class;
  END IF;

  CASE p_reason_class
    WHEN 'NON_BUILDING_BLOCKED', 'AUTO_HEALED_RESIDUE', 'NO_STEP_HISTORY' THEN
      v_target_status := 'building'; v_reset_step := NULL;
    WHEN 'COVERAGE_GAP' THEN
      v_target_status := 'building'; v_reset_step := 'auto_publish';
    WHEN 'HARD_FAIL_NO_CURRICULUM', 'HARD_FAIL_OTHER' THEN
      v_target_status := 'queued'; v_reset_step := NULL;
    ELSE
      v_target_status := 'building'; v_reset_step := NULL;
  END CASE;

  SELECT package_ids[1:p_max_packages] INTO v_pkg_ids
  FROM public.v_admin_blocked_packages_diagnosis
  WHERE reason_class = p_reason_class;

  IF v_pkg_ids IS NULL OR array_length(v_pkg_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'dry_run', p_dry_run, 'candidate_count', 0,
      'reason_class', p_reason_class,
      'message', 'Keine Pakete für diese Klasse gefunden'
    );
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'candidate_count', array_length(v_pkg_ids, 1),
      'reason_class', p_reason_class,
      'target_status', v_target_status,
      'reset_step', v_reset_step,
      'sample_ids', v_pkg_ids[1:5]
    );
  END IF;

  PERFORM set_config('app.transition_source', format('admin_ui:unblock_by_reason:%s:%s', p_reason_class, COALESCE(v_uid::text,'unknown')), true);

  WITH upd AS (
    UPDATE public.course_packages
    SET status = v_target_status, updated_at = now()
    WHERE id = ANY(v_pkg_ids) AND status = 'blocked'
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_unblocked FROM upd;

  WITH steps AS (
    UPDATE public.package_steps
    SET status = 'queued'::step_status,
        last_error = NULL, updated_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'unblocked_by_reason', p_reason_class,
          'unblocked_at', now()
        )
    WHERE package_id = ANY(v_pkg_ids)
      AND status = 'failed'::step_status
      AND (v_reset_step IS NULL OR step_key = v_reset_step)
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_steps_reset FROM steps;

  INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload)
  VALUES (
    v_uid, 'unblock_packages_by_reason', 'course_packages', v_pkg_ids,
    jsonb_build_object(
      'reason_class', p_reason_class,
      'target_status', v_target_status,
      'reset_step', v_reset_step,
      'unblocked', v_unblocked,
      'steps_reset', v_steps_reset
    )
  );

  RETURN jsonb_build_object(
    'dry_run', false,
    'unblocked', v_unblocked,
    'steps_reset', v_steps_reset,
    'reason_class', p_reason_class,
    'target_status', v_target_status,
    'package_ids', v_pkg_ids
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_release_stale_locks(integer,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_drain_queue_backlog(integer,integer,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unblock_packages_by_reason(text,integer,boolean) TO authenticated;