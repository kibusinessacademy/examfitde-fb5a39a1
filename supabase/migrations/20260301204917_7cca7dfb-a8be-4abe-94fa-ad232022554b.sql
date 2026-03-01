
-- Fix 2.1: Guard 1 - only alarm on explicit ok=false, not legacy null meta
-- Fix 2.2: Guard 3 - scope to building packages only
CREATE OR REPLACE FUNCTION public.run_nightly_pipeline_guards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done_not_ok int := 0;
  v_queued_stale int := 0;
  v_building_no_start int := 0;
  v_hollow_published int := 0;
  v_quarantined_ids uuid[] := '{}';
  v_truncated boolean := false;
  rec record;
BEGIN
  -- Guard 1: done but meta.ok explicitly not true (only when ok field exists)
  SELECT COUNT(*) INTO v_done_not_ok
  FROM public.package_steps
  WHERE status = 'done'
    AND (meta ? 'ok')
    AND (meta->>'ok')::text <> 'true';

  IF v_done_not_ok > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('done_implies_ok', jsonb_build_object('count', v_done_not_ok));
  END IF;

  -- Guard 2: queued with stale metadata
  SELECT COUNT(*) INTO v_queued_stale
  FROM public.package_steps
  WHERE status = 'queued'
    AND meta IS NOT NULL
    AND (meta ? 'ok' OR meta ? 'batch_complete');

  IF v_queued_stale > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('queued_meta_hygiene', jsonb_build_object('count', v_queued_stale));
  END IF;

  -- Guard 3: building packages with done steps missing started_at (scoped, not global)
  SELECT COUNT(*) INTO v_building_no_start
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE cp.status = 'building'
    AND ps.status = 'done'
    AND ps.started_at IS NULL
    AND ps.finished_at IS NOT NULL;

  IF v_building_no_start > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('building_done_without_started_at', jsonb_build_object('count', v_building_no_start));
  END IF;

  -- Guard 4: hollow published detection + auto-quarantine (LIMIT 20)
  SELECT COUNT(*) INTO v_hollow_published
  FROM public.v_package_publish_readiness v
  WHERE v.status = 'published'
    AND v.lessons_total > 0
    AND (
      v.lessons_real = 0
      OR v.lessons_placeholder = v.lessons_total
      OR v.lessons_real < CEIL(v.lessons_total * 0.85)
      OR v.cv_approved = 0
      OR v.lessons_qc_approved = 0
    );

  IF v_hollow_published > 20 THEN
    v_truncated := true;
  END IF;

  FOR rec IN
    SELECT v.package_id, v.title
    FROM public.v_package_publish_readiness v
    WHERE v.status = 'published'
      AND v.lessons_total > 0
      AND (
        v.lessons_real = 0
        OR v.lessons_placeholder = v.lessons_total
        OR v.lessons_real < CEIL(v.lessons_total * 0.85)
        OR v.cv_approved = 0
        OR v.lessons_qc_approved = 0
      )
    ORDER BY v.title
    LIMIT 20
  LOOP
    PERFORM public.quarantine_package(rec.package_id, 'hollow_published_auto_quarantine');
    v_quarantined_ids := array_append(v_quarantined_ids, rec.package_id);
  END LOOP;

  IF v_hollow_published > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('hollow_published_auto_quarantine', jsonb_build_object(
      'count', v_hollow_published,
      'quarantined', v_quarantined_ids,
      'truncated', v_truncated
    ));
  END IF;

  RETURN jsonb_build_object(
    'done_but_not_ok', v_done_not_ok,
    'queued_with_stale_meta', v_queued_stale,
    'building_done_without_started_at', v_building_no_start,
    'hollow_published', v_hollow_published,
    'quarantined_ids', to_jsonb(v_quarantined_ids),
    'truncated', v_truncated,
    'all_clear', (v_done_not_ok = 0 AND v_queued_stale = 0 AND v_building_no_start = 0 AND v_hollow_published = 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_nightly_pipeline_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_nightly_pipeline_guards() TO service_role;
