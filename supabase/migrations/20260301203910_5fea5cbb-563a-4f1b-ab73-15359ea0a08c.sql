
-- =====================================================
-- FINAL HARDENING: Publish DoD + Auto-Quarantine + quarantine_package()
-- =====================================================

-- 1) Upgrade publish trigger: 85% real + governance checks
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
  -- Only fire when transitioning TO published
  IF NEW.status != 'published' OR OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- Count lesson stats
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE l.content IS NOT NULL
                       AND length(l.content::text) > 200
                       AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
                       AND (l.content->>'html') IS NOT NULL
                       AND length(l.content->>'html') > 400),
    COUNT(*) FILTER (WHERE (l.content->>'_placeholder')::text = 'true')
  INTO v_total, v_real, v_placeholder
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = NEW.course_id;

  -- Gate 1: Hollow check (0 real OR all placeholder OR <85% real)
  IF v_total > 0 AND (
       v_real = 0
    OR v_placeholder = v_total
    OR v_real < CEIL(v_total * 0.85)
  ) THEN
    NEW.status := 'quality_gate_failed';
    NEW.integrity_passed := false;
    NEW.integrity_report := jsonb_set(
      COALESCE(NEW.integrity_report, '{}'::jsonb),
      '{verdict}',
      to_jsonb(format('HOLLOW_LESSONS: %s/%s real (need 85%%)', v_real, v_total)),
      true
    );
    RAISE WARNING 'PUBLISH_BLOCKED: Package % has %/% real lessons (<85%%). Downgraded.',
      NEW.id, v_real, v_total;
    RETURN NEW;
  END IF;

  -- Gate 2: Governance checks (cv_approved + qc_approved)
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

  IF v_total > 0 AND (v_cv_approved = 0 OR v_qc_approved = 0) THEN
    NEW.status := 'quality_gate_failed';
    NEW.integrity_passed := false;
    NEW.integrity_report := jsonb_set(
      COALESCE(NEW.integrity_report, '{}'::jsonb),
      '{verdict}',
      to_jsonb(format('GOVERNANCE_MISSING: cv_approved=%s, qc_approved=%s', v_cv_approved, v_qc_approved)),
      true
    );
    RAISE WARNING 'PUBLISH_BLOCKED: governance missing for % (cv_approved=%, qc_approved=%).',
      NEW.id, v_cv_approved, v_qc_approved;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- 2) quarantine_package() — SSOT for the quarantine flow
CREATE OR REPLACE FUNCTION public.quarantine_package(
  p_package_id uuid,
  p_reason text DEFAULT 'manual_quarantine'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status text;
  v_title text;
BEGIN
  SELECT status, title INTO v_old_status, v_title
  FROM public.course_packages
  WHERE id = p_package_id;

  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Package not found');
  END IF;

  IF v_old_status NOT IN ('published', 'building', 'done', 'council_review') THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Cannot quarantine from status: %s', v_old_status));
  END IF;

  -- Atomically: status + published_at=NULL (prevents drift guard revert)
  UPDATE public.course_packages
  SET status = 'quality_gate_failed',
      published_at = NULL,
      integrity_passed = false,
      integrity_report = jsonb_build_object(
        'verdict', p_reason,
        'quarantined_at', now(),
        'previous_status', v_old_status
      )
  WHERE id = p_package_id;

  -- Log to guardrail events
  INSERT INTO public.ops_guardrail_events(guard_key, details)
  VALUES ('quarantine', jsonb_build_object(
    'package_id', p_package_id,
    'title', v_title,
    'reason', p_reason,
    'previous_status', v_old_status
  ));

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'title', v_title,
    'previous_status', v_old_status,
    'new_status', 'quality_gate_failed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.quarantine_package(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quarantine_package(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.quarantine_package(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.quarantine_package(uuid, text) TO service_role;

-- 3) Upgrade nightly guards: add hollow detection + auto-quarantine
CREATE OR REPLACE FUNCTION public.run_nightly_pipeline_guards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done_not_ok int;
  v_queued_stale int;
  v_building_done_wo_started int;
  v_hollow_published int;
  v_quarantined_ids text[];
  v_result jsonb;
  rec record;
BEGIN
  -- Guard 1: done but ok != true
  SELECT count(*) INTO v_done_not_ok
  FROM public.package_steps ps
  WHERE ps.status = 'done'
    AND (ps.meta ? 'ok')
    AND (ps.meta->>'ok')::text <> 'true';

  -- Guard 2: queued with stale meta
  SELECT count(*) INTO v_queued_stale
  FROM public.package_steps ps
  WHERE ps.status = 'queued'
    AND (ps.meta ? 'ok' OR ps.meta ? 'batch_complete');

  -- Guard 3: building done without started_at
  SELECT count(*) INTO v_building_done_wo_started
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE cp.status = 'building'
    AND ps.status = 'done'
    AND ps.started_at IS NULL
    AND ps.finished_at IS NOT NULL;

  -- Guard 4: published hollow detection + auto-quarantine
  v_hollow_published := 0;
  v_quarantined_ids := ARRAY[]::text[];

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
  LOOP
    v_hollow_published := v_hollow_published + 1;
    -- Auto-quarantine
    PERFORM public.quarantine_package(rec.package_id, 'nightly_hollow_auto_quarantine');
    v_quarantined_ids := array_append(v_quarantined_ids, rec.package_id::text);
  END LOOP;

  -- Log events for non-zero findings
  IF v_done_not_ok > 0 THEN
    INSERT INTO public.ops_guardrail_events(guard_key, details)
    VALUES ('done_implies_ok', jsonb_build_object('count', v_done_not_ok));
  END IF;

  IF v_queued_stale > 0 THEN
    INSERT INTO public.ops_guardrail_events(guard_key, details)
    VALUES ('queued_meta_hygiene', jsonb_build_object('count', v_queued_stale));
  END IF;

  IF v_building_done_wo_started > 0 THEN
    INSERT INTO public.ops_guardrail_events(guard_key, details)
    VALUES ('building_done_without_started_at', jsonb_build_object('count', v_building_done_wo_started));
  END IF;

  IF v_hollow_published > 0 THEN
    INSERT INTO public.ops_guardrail_events(guard_key, details)
    VALUES ('hollow_published_auto_quarantine', jsonb_build_object(
      'count', v_hollow_published,
      'quarantined', v_quarantined_ids
    ));
  END IF;

  v_result := jsonb_build_object(
    'done_but_not_ok', v_done_not_ok,
    'queued_with_stale_meta', v_queued_stale,
    'building_done_without_started_at', v_building_done_wo_started,
    'hollow_published', v_hollow_published,
    'quarantined_ids', to_jsonb(v_quarantined_ids),
    'all_clear', (v_done_not_ok = 0 AND v_queued_stale = 0 AND v_building_done_wo_started = 0 AND v_hollow_published = 0),
    'checked_at', now()
  );

  RETURN v_result;
END;
$$;

-- Re-apply permissions
REVOKE ALL ON FUNCTION public.run_nightly_pipeline_guards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_nightly_pipeline_guards() FROM anon;
REVOKE ALL ON FUNCTION public.run_nightly_pipeline_guards() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_nightly_pipeline_guards() TO service_role;

-- 4) Allow authenticated users to read guardrail events (for admin UI)
CREATE POLICY "Authenticated can read guardrail events"
  ON public.ops_guardrail_events
  FOR SELECT
  USING (auth.role() = 'authenticated');
