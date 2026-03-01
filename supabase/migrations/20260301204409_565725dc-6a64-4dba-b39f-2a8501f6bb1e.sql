
-- A1) RLS: ops_guardrail_events admin-only (using has_role helper)
DROP POLICY IF EXISTS "Authenticated can read guardrail events" ON public.ops_guardrail_events;

CREATE POLICY "Admins can read guardrail events"
  ON public.ops_guardrail_events
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
  );

-- A2) quarantine_package: merge integrity_report instead of overwrite
CREATE OR REPLACE FUNCTION public.quarantine_package(p_package_id uuid, p_reason text DEFAULT 'manual_quarantine')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status text;
  v_result jsonb;
BEGIN
  SELECT status INTO v_old_status
  FROM public.course_packages
  WHERE id = p_package_id;

  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'package_not_found');
  END IF;

  IF v_old_status = 'quality_gate_failed' THEN
    RETURN jsonb_build_object('success', true, 'note', 'already_quarantined', 'package_id', p_package_id);
  END IF;

  UPDATE public.course_packages
  SET status = 'quality_gate_failed',
      published_at = NULL,
      integrity_passed = false,
      integrity_report =
        jsonb_set(
          jsonb_set(
            COALESCE(integrity_report, '{}'::jsonb),
            '{verdict}', to_jsonb(p_reason), true
          ),
          '{quarantined_at}', to_jsonb(now()::text), true
        )
        || jsonb_build_object('previous_status', v_old_status)
  WHERE id = p_package_id;

  INSERT INTO public.ops_guardrail_events (guard_key, details)
  VALUES ('quarantine', jsonb_build_object(
    'package_id', p_package_id,
    'reason', p_reason,
    'previous_status', v_old_status
  ));

  RETURN jsonb_build_object('success', true, 'package_id', p_package_id, 'previous_status', v_old_status);
END;
$$;

REVOKE ALL ON FUNCTION public.quarantine_package(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quarantine_package(uuid, text) TO service_role;

-- B) Publish trigger: also null published_at on block
CREATE OR REPLACE FUNCTION public.guard_publish_requires_real_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_total int;
  v_real int;
  v_placeholder int;
  v_cv_approved int;
  v_qc_approved int;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    SELECT COUNT(*) INTO v_total
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id;

    SELECT COUNT(*) INTO v_real
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND l.content IS NOT NULL
      AND length(l.content::text) > 200
      AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
      AND (l.content->>'html') IS NOT NULL
      AND length(l.content->>'html') > 400;

    SELECT COUNT(*) INTO v_placeholder
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND (l.content->>'_placeholder')::text = 'true';

    SELECT COUNT(*) INTO v_cv_approved
    FROM public.content_versions cv
    JOIN public.lessons l ON l.id = cv.lesson_id
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND cv.status = 'approved';

    SELECT COUNT(*) INTO v_qc_approved
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id = NEW.course_id
      AND l.qc_status = 'approved';

    -- Block: hollow or insufficient real content
    IF v_total > 0 AND (
         v_real = 0
      OR v_placeholder = v_total
      OR v_real < CEIL(v_total * 0.85)
    ) THEN
      NEW.status := 'quality_gate_failed';
      NEW.published_at := NULL;
      NEW.integrity_passed := false;
      NEW.integrity_report := jsonb_set(
        COALESCE(NEW.integrity_report, '{}'::jsonb),
        '{verdict}',
        '"HOLLOW_LESSONS"'::jsonb,
        true
      );
      RAISE WARNING 'PUBLISH_BLOCKED: hollow content for % (real=%, placeholder=%, total=%).',
        NEW.id, v_real, v_placeholder, v_total;
    -- Block: governance missing
    ELSIF v_total > 0 AND (v_cv_approved = 0 OR v_qc_approved = 0) THEN
      NEW.status := 'quality_gate_failed';
      NEW.published_at := NULL;
      NEW.integrity_passed := false;
      NEW.integrity_report := jsonb_set(
        COALESCE(NEW.integrity_report, '{}'::jsonb),
        '{verdict}',
        '"GOVERNANCE_MISSING"'::jsonb,
        true
      );
      RAISE WARNING 'PUBLISH_BLOCKED: governance missing for % (cv_approved=%, qc_approved=%).',
        NEW.id, v_cv_approved, v_qc_approved;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- C) Nightly guards: add LIMIT 20 to auto-quarantine loop
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
  -- Guard 1: done but meta.ok is not true
  SELECT COUNT(*) INTO v_done_not_ok
  FROM public.package_steps
  WHERE status = 'done'
    AND (meta IS NULL OR meta->>'ok' IS DISTINCT FROM 'true');

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

  -- Guard 3: building done without started_at
  SELECT COUNT(*) INTO v_building_no_start
  FROM public.package_steps
  WHERE status = 'done'
    AND started_at IS NULL;

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
