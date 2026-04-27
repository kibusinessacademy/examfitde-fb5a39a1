
-- ============================================================================
-- FIX 1: admin_normalize_track_steps — Enum-Cast, Spalten, admin_actions schema
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_normalize_track_steps(
  p_dry_run boolean DEFAULT true,
  p_tracks text[] DEFAULT ARRAY['EXAM_FIRST'::text],
  p_max_packages integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_total int := 0;
  v_distinct int := 0;
  v_by_step jsonb;
  v_skipped_count int := 0;
  v_packages_touched int := 0;
  v_affected uuid[];
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  -- Kandidaten ermitteln (ohne Modify) — track_step_applicability.track ist enum, track_step_applicability.should_run ist Boolean
  WITH cand AS (
    SELECT
      ps.id AS step_id,
      ps.package_id,
      ps.step_key,
      ps.status::text AS current_status
    FROM public.package_steps ps
    JOIN public.v_admin_publish_readiness r ON r.package_id = ps.package_id
    JOIN public.track_step_applicability tsa
      ON tsa.track = (r.package_track)::public.product_track
     AND tsa.step_key = ps.step_key
    WHERE r.package_track = ANY(p_tracks)
      AND tsa.should_run = false
      AND ps.status::text NOT IN ('skipped', 'done')
    LIMIT (p_max_packages * 30)
  )
  SELECT
    coalesce((SELECT count(*) FROM cand), 0),
    coalesce((SELECT count(DISTINCT package_id) FROM cand), 0),
    coalesce((SELECT jsonb_object_agg(step_key, cnt)
              FROM (SELECT step_key, count(*) AS cnt FROM cand GROUP BY step_key) g), '{}'::jsonb)
  INTO v_total, v_distinct, v_by_step;

  IF p_dry_run THEN
    INSERT INTO public.admin_actions (user_id, action, payload, scope)
    VALUES (
      v_uid,
      'admin_normalize_track_steps:dry_run',
      jsonb_build_object(
        'tracks', p_tracks,
        'candidates', jsonb_build_object('total_candidates', v_total, 'distinct_packages', v_distinct, 'by_step', v_by_step)
      ),
      'system'
    );
    RETURN jsonb_build_object(
      'dry_run', true,
      'candidates', jsonb_build_object('total_candidates', v_total, 'distinct_packages', v_distinct, 'by_step', v_by_step)
    );
  END IF;

  -- Execute
  WITH to_skip AS (
    SELECT ps.id AS step_id, ps.package_id
    FROM public.package_steps ps
    JOIN public.v_admin_publish_readiness r ON r.package_id = ps.package_id
    JOIN public.track_step_applicability tsa
      ON tsa.track = (r.package_track)::public.product_track
     AND tsa.step_key = ps.step_key
    WHERE r.package_track = ANY(p_tracks)
      AND tsa.should_run = false
      AND ps.status::text NOT IN ('skipped', 'done')
    LIMIT (p_max_packages * 30)
  ),
  upd AS (
    UPDATE public.package_steps ps
    SET status = 'skipped',
        meta = coalesce(ps.meta, '{}'::jsonb) || jsonb_build_object(
          'track_normalized', true,
          'normalize_reason', 'TRACK_NOT_APPLICABLE',
          'normalized_at', now()
        ),
        updated_at = now()
    FROM to_skip s
    WHERE ps.id = s.step_id
    RETURNING ps.package_id
  )
  SELECT count(*), count(DISTINCT package_id), array_agg(DISTINCT package_id)
  INTO v_skipped_count, v_packages_touched, v_affected
  FROM upd;

  INSERT INTO public.admin_actions (user_id, action, payload, scope, affected_ids)
  VALUES (
    v_uid,
    'admin_normalize_track_steps:execute',
    jsonb_build_object('tracks', p_tracks, 'skipped_steps', v_skipped_count, 'packages_touched', v_packages_touched),
    'package',
    coalesce(v_affected, ARRAY[]::uuid[])
  );

  RETURN jsonb_build_object(
    'dry_run', false,
    'skipped_steps', v_skipped_count,
    'packages_touched', v_packages_touched,
    'tracks', p_tracks
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_normalize_track_steps(boolean, text[], integer) TO authenticated;

-- ============================================================================
-- FIX 2: fn_reap_stale_jobs_configurable — Grant für authenticated (Admin-Guard intern)
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.fn_reap_stale_jobs_configurable() TO authenticated;

-- ============================================================================
-- FIX 3: admin_bulk_depublish_hollow — falls noch step_key Probleme bestehen (idempotent)
-- ============================================================================
-- (Diese Funktion wurde in 86aa53d3 fixiert; sicherheitshalber Grant-Refresh)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_bulk_depublish_hollow') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_bulk_depublish_hollow(boolean, integer) TO authenticated';
  END IF;
END$$;

-- ============================================================================
-- NEW: admin_resume_council_deferred — Bulk-Heal für STALE_WORKER_PATTERN_3X
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_resume_council_deferred(
  p_dry_run boolean DEFAULT true,
  p_max_packages integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_targets uuid[];
  v_pkg uuid;
  v_per_pkg jsonb := '[]'::jsonb;
  v_total int := 0;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  SELECT array_agg(DISTINCT cdl.package_id)
  INTO v_targets
  FROM public.council_defer_log cdl
  WHERE cdl.cleared_at IS NULL
    AND cdl.deferred_at > now() - interval '30 days'
  LIMIT p_max_packages;

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'packages', 0, 'per_package', '[]'::jsonb);
  END IF;

  IF p_dry_run THEN
    SELECT jsonb_agg(jsonb_build_object(
      'package_id', cdl.package_id,
      'fail_count', cdl.fail_count,
      'defer_reason', cdl.defer_reason,
      'deferred_at', cdl.deferred_at
    ))
    INTO v_per_pkg
    FROM public.council_defer_log cdl
    WHERE cdl.package_id = ANY(v_targets) AND cdl.cleared_at IS NULL;

    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'packages', array_length(v_targets, 1),
      'per_package', coalesce(v_per_pkg, '[]'::jsonb)
    );
  END IF;

  -- Execute
  FOREACH v_pkg IN ARRAY v_targets LOOP
    -- 1. Clear defer log
    UPDATE public.council_defer_log
    SET cleared_at = now(),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'cleared_by', 'admin_resume_council_deferred',
          'cleared_admin', v_uid
        )
    WHERE package_id = v_pkg AND cleared_at IS NULL;

    -- 2. Reset quality_council step zu queued (regression-allow + reseed)
    UPDATE public.package_steps
    SET status = 'queued',
        attempts = 0,
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'admin_resume_council_deferred',
          'reset_reason', 'admin_resume_council_after_stale_pattern',
          'reset_at', now()::text,
          'council_defer_cleared', true
        ),
        updated_at = now()
    WHERE package_id = v_pkg
      AND step_key = 'quality_council'
      AND status::text IN ('failed', 'pending', 'pending_enqueue', 'skipped');

    -- 3. Job anstoßen (Trigger erkennt queued + erzeugt Job durch atomic-coupling)
    PERFORM public.enqueue_job_if_absent(
      'package_quality_council'::text,
      v_pkg,
      jsonb_build_object('package_id', v_pkg, 'resumed_from_defer', true)
    );

    v_per_pkg := v_per_pkg || jsonb_build_object('package_id', v_pkg, 'action', 'resumed');
    v_total := v_total + 1;
  END LOOP;

  INSERT INTO public.admin_actions (user_id, action, payload, scope, affected_ids)
  VALUES (
    v_uid,
    'admin_resume_council_deferred',
    jsonb_build_object('packages_resumed', v_total),
    'package',
    v_targets
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'packages', v_total,
    'per_package', v_per_pkg
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_resume_council_deferred(boolean, integer) TO authenticated;

-- ============================================================================
-- NEW: admin_resume_single_council_deferred — One-Click pro Paket
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_resume_single_council_deferred(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cleared int;
  v_step_updated int;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'package_id required';
  END IF;

  -- Clear defer log
  WITH x AS (
    UPDATE public.council_defer_log
    SET cleared_at = now(),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cleared_by','admin_single_resume','cleared_admin', v_uid)
    WHERE package_id = p_package_id AND cleared_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_cleared FROM x;

  -- Reset Step
  WITH y AS (
    UPDATE public.package_steps
    SET status = 'queued',
        attempts = 0,
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'admin_single_resume_council',
          'reset_reason', 'manual_admin_resume',
          'reset_at', now()::text,
          'council_defer_cleared', true
        ),
        updated_at = now()
    WHERE package_id = p_package_id
      AND step_key = 'quality_council'
      AND status::text IN ('failed', 'pending', 'pending_enqueue', 'skipped')
    RETURNING 1
  )
  SELECT count(*) INTO v_step_updated FROM y;

  PERFORM public.enqueue_job_if_absent(
    'package_quality_council'::text,
    p_package_id,
    jsonb_build_object('package_id', p_package_id, 'resumed_from_defer', true, 'manual', true)
  );

  INSERT INTO public.admin_actions (user_id, action, payload, scope, affected_ids)
  VALUES (
    v_uid,
    'admin_resume_single_council_deferred',
    jsonb_build_object('package_id', p_package_id, 'defer_cleared', v_cleared, 'step_updated', v_step_updated),
    'package',
    ARRAY[p_package_id]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'defer_cleared', v_cleared,
    'step_updated', v_step_updated
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_resume_single_council_deferred(uuid) TO authenticated;
