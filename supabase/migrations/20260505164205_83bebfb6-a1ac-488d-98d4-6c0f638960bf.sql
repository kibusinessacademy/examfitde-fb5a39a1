-- Publish-Guard Level 2: warn-only readiness check covering minichecks + pipeline jobs.
-- Default: writes warning to auto_heal_log but does NOT block.
-- Opt-in enforcement via session GUC: set_config('app.publish_guard_level2','enforce',true).

CREATE OR REPLACE FUNCTION public.fn_guard_course_publish_readiness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- Only fire on transitions INTO 'published'
  IF NEW.status IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

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
        'modules', v_module_count, 'lessons', v_lesson_count,
        'curriculum_id', NEW.curriculum_id, 'missing', v_missing,
        'source', COALESCE(v_source, 'unknown')
      )
    );

    RAISE EXCEPTION 'COURSE_PUBLISH_READINESS_BLOCKED: course % missing %', NEW.id, v_missing
      USING ERRCODE = 'check_violation',
            HINT = 'Set app.transition_source=admin_force_publish to bypass (admin only).';
  END IF;

  -- ── Level 2 (warn-only by default) ──
  SELECT COUNT(*) FILTER (WHERE l.status = 'ready' OR l.generation_status = 'ready')
    INTO v_lessons_ready
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
   WHERE m.course_id = NEW.id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'approved')
    INTO v_minicheck_sets_total, v_minicheck_sets_approved
    FROM public.minicheck_sets WHERE course_id = NEW.id;

  -- Resolve associated package via curriculum (best-effort)
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
$$;

COMMENT ON FUNCTION public.fn_guard_course_publish_readiness() IS
  'Publish-Guard v2: L1 (modules+lessons+curriculum) hard-blocks. L2 (minichecks + pipeline jobs) warn-only by default; enforce via session GUC app.publish_guard_level2=enforce. Admin bypass via app.transition_source=admin_force_publish. Audit: course_publish_readiness_{blocked|bypassed|l2_warned|l2_blocked|l2_bypassed}.';

-- Test helper: enforce L2 within the transaction, attempt publish, return state.
CREATE OR REPLACE FUNCTION public.admin_force_publish_course_l2_for_test(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  -- Admin-only
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.publish_guard_level2','enforce', true);
  PERFORM set_config('app.transition_source','ci_l2_test', true);
  UPDATE public.courses SET status = 'published' WHERE id = _course_id;
  SELECT status INTO v_status FROM public.courses WHERE id = _course_id;
  RETURN jsonb_build_object('ok', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_publish_course_l2_for_test(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_publish_course_l2_for_test(uuid) TO service_role;