-- ============================================================================
-- Track-aware course-publish-readiness guard
-- ============================================================================
-- Concern: ONE — make L1 modules/lessons assertion track-aware.
-- L2 (warn-only) bleibt unverändert.
-- ============================================================================

-- Helper: resolve track for a course_id (via course_packages)
CREATE OR REPLACE FUNCTION public.fn_resolve_course_track(p_course_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.track::text
  FROM public.course_packages cp
  WHERE cp.course_id = p_course_id
  ORDER BY cp.created_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_course_track(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_course_track(uuid) TO service_role;

-- Helper: are lesson-pipeline steps cleanly skipped for the package?
-- Used as guardrail for EXAM_FIRST_PLUS: only skip L1 modules/lessons check
-- if the pipeline genuinely skipped lesson generation.
CREATE OR REPLACE FUNCTION public.fn_lesson_steps_cleanly_skipped(p_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pkg AS (
    SELECT id FROM public.course_packages
     WHERE course_id = p_course_id
     ORDER BY created_at DESC NULLS LAST LIMIT 1
  ),
  steps AS (
    SELECT step_key, status FROM public.package_steps
     WHERE package_id IN (SELECT id FROM pkg)
       AND step_key IN ('scaffold_learning_course','fanout_learning_content','validate_lesson_minichecks')
  )
  SELECT
    COALESCE(BOOL_AND(status = 'skipped'), false)
    AND COUNT(*) >= 2
  FROM steps;
$$;

REVOKE ALL ON FUNCTION public.fn_lesson_steps_cleanly_skipped(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lesson_steps_cleanly_skipped(uuid) TO service_role;

-- ── Patched guard ──
CREATE OR REPLACE FUNCTION public.fn_guard_course_publish_readiness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_module_count int;
  v_lesson_count int;
  v_lessons_ready int;
  v_minicheck_sets_total int;
  v_minicheck_sets_approved int;
  v_pending_minicheck_jobs int;
  v_failed_minicheck_jobs int;
  v_package_id uuid;
  v_source text;
  v_l2_mode text;
  v_missing text[] := ARRAY[]::text[];
  v_l2_reasons text[] := ARRAY[]::text[];
  v_track text;
  v_lessons_skipped boolean := false;
  v_track_skip boolean := false;
BEGIN
  -- Only fire on transitions INTO 'published'
  IF NEW.status IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- Resolve track + lesson-step state up front
  v_track := public.fn_resolve_course_track(NEW.id);

  -- ── Level 1 (hard) ──
  SELECT COUNT(*) INTO v_module_count
    FROM public.modules WHERE course_id = NEW.id;
  SELECT COUNT(*) INTO v_lesson_count
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = NEW.id;

  IF NEW.curriculum_id IS NULL THEN v_missing := array_append(v_missing, 'curriculum_id'); END IF;
  IF v_module_count = 0      THEN v_missing := array_append(v_missing, 'modules'); END IF;
  IF v_lesson_count = 0      THEN v_missing := array_append(v_missing, 'lessons'); END IF;

  v_source := current_setting('app.transition_source', true);

  -- ── Track-aware skip for modules/lessons ──
  -- EXAM_FIRST: never produces modules/lessons (by design) → skip both
  -- EXAM_FIRST_PLUS: skip only when lesson-pipeline steps are cleanly skipped
  -- AUSBILDUNG_VOLL / STUDIUM / NULL / other: keep strict check
  IF v_track = 'EXAM_FIRST' THEN
    v_track_skip := true;
  ELSIF v_track = 'EXAM_FIRST_PLUS' THEN
    v_lessons_skipped := public.fn_lesson_steps_cleanly_skipped(NEW.id);
    v_track_skip := v_lessons_skipped;
  END IF;

  IF v_track_skip THEN
    -- Strip 'modules' and 'lessons' from missing[], keep curriculum_id check
    v_missing := ARRAY(
      SELECT m FROM unnest(v_missing) AS m WHERE m NOT IN ('modules','lessons')
    );

    -- Audit only when we actually skipped a real violation
    IF v_module_count = 0 OR v_lesson_count = 0 THEN
      INSERT INTO public.auto_heal_log (
        action_type, trigger_source, target_type, target_id, result_status, metadata
      ) VALUES (
        'course_publish_readiness_track_aware_skip',
        'fn_guard_course_publish_readiness',
        'course', NEW.id::text, 'skipped',
        jsonb_build_object(
          'track', v_track,
          'modules', v_module_count,
          'lessons', v_lesson_count,
          'curriculum_id', NEW.curriculum_id,
          'lessons_pipeline_skipped', v_lessons_skipped,
          'source', COALESCE(v_source, 'unknown')
        )
      );
    END IF;
  END IF;

  -- L1 violation: existing behaviour (block unless admin bypass).
  IF array_length(v_missing, 1) IS NOT NULL THEN
    IF v_source = 'admin_force_publish' THEN
      INSERT INTO public.auto_heal_log (
        action_type, trigger_source, target_type, target_id, result_status, metadata
      ) VALUES (
        'course_publish_readiness_bypassed',
        'fn_guard_course_publish_readiness',
        'course', NEW.id::text, 'bypassed',
        jsonb_build_object(
          'track', v_track,
          'modules', v_module_count, 'lessons', v_lesson_count,
          'curriculum_id', NEW.curriculum_id, 'missing', v_missing,
          'source', v_source
        )
      );
      RETURN NEW;
    END IF;

    INSERT INTO public.auto_heal_log (
      action_type, trigger_source, target_type, target_id, result_status, metadata
    ) VALUES (
      'course_publish_readiness_blocked',
      'fn_guard_course_publish_readiness',
      'course', NEW.id::text, 'blocked',
      jsonb_build_object(
        'track', v_track,
        'modules', v_module_count, 'lessons', v_lesson_count,
        'curriculum_id', NEW.curriculum_id, 'missing', v_missing,
        'source', COALESCE(v_source, 'unknown')
      )
    );

    RAISE EXCEPTION 'COURSE_PUBLISH_READINESS_BLOCKED: course % missing %', NEW.id, v_missing
      USING ERRCODE = 'check_violation',
            HINT = 'Set app.transition_source=admin_force_publish to bypass (admin only).';
  END IF;

  -- ── Level 2 (warn-only by default) — unverändert, aber Lesson/Minicheck-Reasons
  -- für track-skip-Fälle nicht nochmal als Block hochziehen ──
  IF v_track_skip THEN
    -- EXAM_FIRST(_PLUS) hat per Design keine Lessons/MiniCheck-Sets — nichts zu prüfen
    RETURN NEW;
  END IF;

  SELECT COUNT(*) FILTER (WHERE l.status = 'ready' OR l.generation_status = 'ready')
    INTO v_lessons_ready
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = NEW.id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'approved')
    INTO v_minicheck_sets_total, v_minicheck_sets_approved
    FROM public.minicheck_sets WHERE course_id = NEW.id;

  SELECT id INTO v_package_id
    FROM public.course_packages
   WHERE curriculum_id = NEW.curriculum_id
   ORDER BY created_at DESC NULLS LAST
   LIMIT 1;

  IF v_package_id IS NOT NULL THEN
    SELECT
      COUNT(*) FILTER (WHERE status IN ('pending','queued','running','retry')),
      COUNT(*) FILTER (WHERE status IN ('failed','dead_letter'))
      INTO v_pending_minicheck_jobs, v_failed_minicheck_jobs
      FROM public.job_queue
     WHERE package_id = v_package_id
       AND job_type IN ('package_generate_lesson_minichecks','package_validate_lesson_minichecks');
  ELSE
    v_pending_minicheck_jobs := 0; v_failed_minicheck_jobs := 0;
  END IF;

  IF v_lessons_ready = 0 THEN v_l2_reasons := array_append(v_l2_reasons,'NO_READY_LESSONS'); END IF;
  IF v_minicheck_sets_total = 0 THEN v_l2_reasons := array_append(v_l2_reasons,'NO_MINICHECK_SETS'); END IF;
  IF v_minicheck_sets_total > 0 AND v_minicheck_sets_approved = 0 THEN
    v_l2_reasons := array_append(v_l2_reasons,'MINICHECKS_NOT_APPROVED');
  END IF;
  IF v_pending_minicheck_jobs > 0 THEN v_l2_reasons := array_append(v_l2_reasons,'MINICHECK_JOBS_PENDING'); END IF;
  IF v_failed_minicheck_jobs > 0 THEN v_l2_reasons := array_append(v_l2_reasons,'MINICHECK_JOBS_FAILED'); END IF;

  IF array_length(v_l2_reasons, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_l2_mode := COALESCE(current_setting('app.publish_guard_level2', true), 'warn');

  IF v_l2_mode = 'enforce' AND v_source IS DISTINCT FROM 'admin_force_publish' THEN
    INSERT INTO public.auto_heal_log (
      action_type, trigger_source, target_type, target_id, result_status, metadata
    ) VALUES (
      'course_publish_readiness_l2_blocked',
      'fn_guard_course_publish_readiness',
      'course', NEW.id::text, 'blocked',
      jsonb_build_object(
        'track', v_track,
        'modules', v_module_count, 'lessons', v_lesson_count,
        'lessons_ready', v_lessons_ready,
        'minicheck_sets_total', v_minicheck_sets_total,
        'minicheck_sets_approved', v_minicheck_sets_approved,
        'pending_minicheck_jobs', v_pending_minicheck_jobs,
        'failed_minicheck_jobs', v_failed_minicheck_jobs,
        'package_id', v_package_id,
        'l2_reasons', v_l2_reasons,
        'l2_mode', v_l2_mode,
        'source', COALESCE(v_source, 'unknown')
      )
    );
    RAISE EXCEPTION 'COURSE_PUBLISH_READINESS_L2_BLOCKED: course % reasons %', NEW.id, v_l2_reasons
      USING ERRCODE = 'check_violation',
            HINT = 'Resolve pipeline blockers or set app.transition_source=admin_force_publish.';
  END IF;

  -- Warn-only path (default)
  INSERT INTO public.auto_heal_log (
    action_type, trigger_source, target_type, target_id, result_status, metadata
  ) VALUES (
    CASE WHEN v_source = 'admin_force_publish'
         THEN 'course_publish_readiness_l2_bypassed'
         ELSE 'course_publish_readiness_l2_warned' END,
    'fn_guard_course_publish_readiness',
    'course', NEW.id::text,
    CASE WHEN v_source = 'admin_force_publish' THEN 'bypassed' ELSE 'warned' END,
    jsonb_build_object(
      'track', v_track,
      'modules', v_module_count, 'lessons', v_lesson_count,
      'lessons_ready', v_lessons_ready,
      'minicheck_sets_total', v_minicheck_sets_total,
      'minicheck_sets_approved', v_minicheck_sets_approved,
      'pending_minicheck_jobs', v_pending_minicheck_jobs,
      'failed_minicheck_jobs', v_failed_minicheck_jobs,
      'package_id', v_package_id,
      'l2_reasons', v_l2_reasons,
      'l2_mode', v_l2_mode,
      'source', COALESCE(v_source, 'unknown')
    )
  );

  RETURN NEW;
END;
$function$;

-- ── Smoke (read-only proof) ──
DO $$
DECLARE
  v_ef_zero_mod_count int;
  v_av_strict_count int;
BEGIN
  -- EXAM_FIRST published OHNE modules existiert bereits (29 baseline) → bestätigt by-design
  SELECT COUNT(*) INTO v_ef_zero_mod_count
  FROM course_packages cp
  WHERE cp.status = 'published' AND cp.track = 'EXAM_FIRST'
    AND cp.course_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.course_id = cp.course_id);

  -- AUSBILDUNG_VOLL published OHNE modules darf weiterhin nicht existieren (strict)
  SELECT COUNT(*) INTO v_av_strict_count
  FROM course_packages cp
  WHERE cp.status = 'published' AND cp.track = 'AUSBILDUNG_VOLL'
    AND cp.course_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.course_id = cp.course_id);

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, result_status, metadata)
  VALUES (
    'course_publish_readiness_track_aware_smoke',
    'migration:track_aware_publish_guard',
    'system', 'ok',
    jsonb_build_object(
      'exam_first_zero_modules_baseline', v_ef_zero_mod_count,
      'ausbildung_voll_zero_modules_should_be_zero', v_av_strict_count,
      'note', 'EXAM_FIRST + EXAM_FIRST_PLUS (clean-skip) now bypass modules/lessons L1 check'
    )
  );
END $$;
