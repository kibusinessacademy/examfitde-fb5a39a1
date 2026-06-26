
-- ============================================================================
-- EXAMFIT.PUBLISH.DRIFT.REPAIR.1
-- Extends publish readiness + adds reaper + validating meta-drift backfill
-- ============================================================================

-- 1) admin_check_publish_readiness — extended with explicit signals + final_status
CREATE OR REPLACE FUNCTION public.admin_check_publish_readiness(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg          record;
  v_steps_total  int;
  v_steps_done   int;
  v_steps_open   jsonb;
  v_meta_issues  jsonb;
  v_recent_blocks jsonb;
  v_signals      jsonb := '{}'::jsonb;
  v_reasons      text[] := ARRAY[]::text[];
  v_bronze_review boolean;
  v_final_status text;
BEGIN
  SELECT cp.id, cp.title, cp.status, cp.is_published, cp.council_approved,
         cp.integrity_passed, cp.blocked_reason, cp.stuck_reason, cp.feature_flags
  INTO v_pkg
  FROM public.course_packages cp WHERE cp.id = p_package_id;

  IF v_pkg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status IN ('done','skipped'))
  INTO v_steps_total, v_steps_done
  FROM public.package_steps WHERE package_id = p_package_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'step_key', step_key, 'status', status, 'last_error', last_error,
    'attempts', attempts, 'updated_at', updated_at
  ) ORDER BY updated_at DESC), '[]'::jsonb)
  INTO v_steps_open
  FROM public.package_steps
  WHERE package_id = p_package_id AND status NOT IN ('done','skipped');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'step_key', step_key,
    'meta_ok', COALESCE(meta->>'ok','false'),
    'meta_executed', COALESCE(meta->>'executed','false'),
    'updated_at', updated_at
  )), '[]'::jsonb)
  INTO v_meta_issues
  FROM public.package_steps
  WHERE package_id = p_package_id
    AND status = 'done'
    AND COALESCE(meta->>'ok','false') <> 'true';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'step_key', step_key, 'meta_ok', meta_ok, 'meta_executed', meta_executed,
    'source_fn', source_fn, 'created_at', created_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_recent_blocks
  FROM (
    SELECT * FROM public.step_done_meta_audit
    WHERE package_id = p_package_id AND meta_ok = false
    ORDER BY created_at DESC LIMIT 20
  ) t;

  v_bronze_review := COALESCE((v_pkg.feature_flags->'bronze'->>'requires_review')::boolean, false)
    OR COALESCE(v_pkg.feature_flags->'bronze'->>'final_state','') = 'requires_review';

  -- Build explicit signal map
  v_signals := jsonb_build_object(
    'INTEGRITY_OK',              COALESCE(v_pkg.integrity_passed, false),
    'COUNCIL_OK',                COALESCE(v_pkg.council_approved, false),
    'OPEN_STEPS_REMAIN',         jsonb_array_length(v_steps_open) > 0,
    'STEP_DONE_WITHOUT_META_OK', jsonb_array_length(v_meta_issues) > 0,
    'BRONZE_REVIEW_REQUIRED',    v_bronze_review,
    'PACKAGE_BLOCKED',           v_pkg.blocked_reason IS NOT NULL
  );

  -- Reason aggregation (matching signals true => blocker)
  IF jsonb_array_length(v_steps_open) > 0 THEN
    v_reasons := array_append(v_reasons, 'OPEN_STEPS_REMAIN');
  END IF;
  IF jsonb_array_length(v_meta_issues) > 0 THEN
    v_reasons := array_append(v_reasons, 'STEP_DONE_WITHOUT_META_OK');
  END IF;
  IF NOT COALESCE(v_pkg.council_approved, false) THEN
    v_reasons := array_append(v_reasons, 'COUNCIL_NOT_APPROVED');
  END IF;
  IF NOT COALESCE(v_pkg.integrity_passed, false) THEN
    v_reasons := array_append(v_reasons, 'INTEGRITY_NOT_PASSED');
  END IF;
  IF v_bronze_review THEN
    v_reasons := array_append(v_reasons, 'BRONZE_REVIEW_REQUIRED');
  END IF;
  IF v_pkg.blocked_reason IS NOT NULL THEN
    v_reasons := array_append(v_reasons, 'PKG_BLOCKED:' || v_pkg.blocked_reason);
  END IF;

  -- Derive final_status (hard SSOT)
  v_final_status := CASE
    WHEN COALESCE(v_pkg.is_published, false) THEN 'published'
    WHEN array_length(v_reasons, 1) IS NULL THEN 'publishable'
    WHEN jsonb_array_length(v_steps_open) > 0
      OR jsonb_array_length(v_meta_issues) > 0 THEN 'rebuilding'
    WHEN v_bronze_review
      AND COALESCE(v_pkg.integrity_passed,false)
      AND COALESCE(v_pkg.council_approved,false) THEN 'review_required'
    ELSE 'blocked'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'package_title', v_pkg.title,
    'package_status', v_pkg.status,
    'is_published', v_pkg.is_published,
    'ready', (array_length(v_reasons, 1) IS NULL),
    'final_status', v_final_status,
    'signals', v_signals,
    'reasons', to_jsonb(v_reasons),
    'steps_total', v_steps_total,
    'steps_done', v_steps_done,
    'open_steps', v_steps_open,
    'meta_ok_drift', v_meta_issues,
    'recent_guard_blocks', v_recent_blocks,
    'bronze', v_pkg.feature_flags->'bronze',
    'evaluated_at', now()
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_check_publish_readiness(uuid) TO authenticated, service_role;

-- ============================================================================
-- 2) admin_repair_done_with_open_steps — Reaper
--    Demotes course_packages.status='done' to 'building' when open steps exist.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_repair_done_with_open_steps(p_cap integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap int := GREATEST(1, LEAST(COALESCE(p_cap,50), 500));
  v_repaired int := 0;
  v_pkg record;
  v_open_keys text[];
  v_open_count int;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.title
    FROM public.course_packages cp
    WHERE cp.status = 'done'
      AND cp.published_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.status NOT IN ('done','skipped')
      )
    ORDER BY cp.updated_at ASC
    LIMIT v_cap
  LOOP
    SELECT array_agg(step_key ORDER BY step_key), count(*)
    INTO v_open_keys, v_open_count
    FROM public.package_steps
    WHERE package_id = v_pkg.id
      AND status NOT IN ('done','skipped');

    UPDATE public.course_packages
    SET status = 'building',
        updated_at = now()
    WHERE id = v_pkg.id
      AND status = 'done'
      AND published_at IS NULL;

    -- Re-arm any 'pending_enqueue' steps so the scheduler picks them up
    UPDATE public.package_steps
    SET status = 'queued',
        updated_at = now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'rearmed_at', now(),
          'rearmed_reason', 'PACKAGE_STATUS_REPAIRED_FROM_DONE_TO_BUILDING'
        )
    WHERE package_id = v_pkg.id
      AND status = 'pending_enqueue';

    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'PACKAGE_STATUS_REPAIRED_FROM_DONE_TO_BUILDING',
      'reaper_done_open_steps',
      'course_package',
      v_pkg.id::text,
      'ok',
      format('Package %s demoted to building; %s open steps', v_pkg.id, v_open_count),
      jsonb_build_object(
        'package_id', v_pkg.id,
        'package_title', v_pkg.title,
        'open_step_count', v_open_count,
        'affected_step_keys', to_jsonb(v_open_keys)
      )
    );

    v_repaired := v_repaired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'cap', v_cap,
    'repaired', v_repaired,
    'evaluated_at', now()
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_repair_done_with_open_steps(integer) TO authenticated, service_role;

-- ============================================================================
-- 3) admin_validate_step_meta_drift — Validating Meta-OK Backfill
--    Per drifted done-step: check if real artifacts exist for the curriculum/package.
--    If yes → meta.ok=true + audit. If no → demote to queued + audit.
--    Unknown step keys → demote (never blind ok=true).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_validate_step_meta_drift(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_step record;
  v_validated int := 0;
  v_demoted int := 0;
  v_skipped int := 0;
  v_artifact_count bigint;
  v_threshold int;
  v_valid boolean;
  v_action_detail text;
BEGIN
  -- Admin gate (allow service_role bypass via NULL auth.uid())
  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_required');
  END IF;

  SELECT id, curriculum_id, title FROM public.course_packages
  WHERE id = p_package_id INTO v_pkg;

  IF v_pkg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  FOR v_step IN
    SELECT step_key, status, meta
    FROM public.package_steps
    WHERE package_id = p_package_id
      AND status = 'done'
      AND COALESCE(meta->>'ok','false') <> 'true'
    ORDER BY step_key
  LOOP
    v_artifact_count := NULL;
    v_threshold := 1;
    v_valid := false;

    -- Step-key whitelist registry (conservative artifact checks)
    CASE v_step.step_key
      WHEN 'scaffold_learning_course' THEN
        SELECT count(*) INTO v_artifact_count FROM public.modules m
        JOIN public.courses c ON c.id = m.course_id
        WHERE c.curriculum_id = v_pkg.curriculum_id;
        v_threshold := 3;

      WHEN 'fanout_learning_content','generate_learning_content','finalize_learning_content' THEN
        SELECT count(*) INTO v_artifact_count FROM public.lessons l
        JOIN public.modules m ON m.id = l.module_id
        JOIN public.courses c ON c.id = m.course_id
        WHERE c.curriculum_id = v_pkg.curriculum_id;
        v_threshold := 10;

      WHEN 'validate_learning_content' THEN
        SELECT count(*) INTO v_artifact_count FROM public.lessons l
        JOIN public.modules m ON m.id = l.module_id
        JOIN public.courses c ON c.id = m.course_id
        WHERE c.curriculum_id = v_pkg.curriculum_id
          AND COALESCE(length(l.content::text), 0) > 100;
        v_threshold := 10;

      WHEN 'expand_handbook','generate_handbook','enqueue_handbook_expand' THEN
        SELECT count(*) INTO v_artifact_count FROM public.handbook_chapters
        WHERE curriculum_id = v_pkg.curriculum_id;
        v_threshold := 3;

      WHEN 'validate_handbook','validate_handbook_depth' THEN
        SELECT count(*) INTO v_artifact_count FROM public.handbook_sections hs
        JOIN public.handbook_chapters hc ON hc.id = hs.chapter_id
        WHERE hc.curriculum_id = v_pkg.curriculum_id;
        v_threshold := 10;

      WHEN 'generate_lesson_minichecks','validate_lesson_minichecks' THEN
        SELECT count(*) INTO v_artifact_count FROM public.minicheck_questions
        WHERE curriculum_id = v_pkg.curriculum_id;
        v_threshold := 10;

      WHEN 'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality' THEN
        SELECT count(*) INTO v_artifact_count FROM public.exam_questions
        WHERE curriculum_id = v_pkg.curriculum_id OR package_id = p_package_id;
        v_threshold := 20;

      WHEN 'auto_seed_exam_blueprints','validate_blueprints' THEN
        SELECT count(*) INTO v_artifact_count FROM public.exam_blueprints
        WHERE curriculum_id = v_pkg.curriculum_id OR package_id = p_package_id;
        v_threshold := 1;

      WHEN 'build_ai_tutor_index','validate_tutor_index' THEN
        SELECT count(*) INTO v_artifact_count FROM public.ai_tutor_context_index
        WHERE package_id = p_package_id;
        v_threshold := 5;

      WHEN 'generate_glossary' THEN
        -- Profession-scoped; skip if we cannot link safely (no curriculum→beruf join here).
        v_artifact_count := NULL;

      ELSE
        v_artifact_count := NULL;
    END CASE;

    IF v_artifact_count IS NULL THEN
      -- Unknown / un-checkable step → demote (never blind ok=true)
      v_skipped := v_skipped + 1;
      v_action_detail := format('Step %s: no validator registered → demoted', v_step.step_key);

      UPDATE public.package_steps
      SET status = 'queued',
          updated_at = now(),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'demoted_at', now(),
            'demoted_reason', 'NO_VALIDATOR_FOR_STEP_KEY',
            'validated_by', 'admin_validate_step_meta_drift'
          )
      WHERE package_id = p_package_id AND step_key = v_step.step_key;

      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'STEP_DEMOTED_NEEDS_REBUILD',
        'admin_validate_step_meta_drift',
        'package_step', p_package_id::text || ':' || v_step.step_key,
        'ok', v_action_detail,
        jsonb_build_object(
          'package_id', p_package_id,
          'step_key', v_step.step_key,
          'reason', 'no_validator',
          'actor', v_uid
        )
      );

    ELSIF v_artifact_count >= v_threshold THEN
      v_valid := true;
      v_validated := v_validated + 1;
      v_action_detail := format('Step %s: validated (%s artifacts >= %s)', v_step.step_key, v_artifact_count, v_threshold);

      UPDATE public.package_steps
      SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'ok', 'true',
            'executed', 'true',
            'backfilled_by', 'validated_reaudit',
            'backfilled_at', now(),
            'artifact_count', v_artifact_count,
            'artifact_threshold', v_threshold
          ),
          updated_at = now()
      WHERE package_id = p_package_id AND step_key = v_step.step_key;

      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'STEP_META_VALIDATED_BACKFILL',
        'admin_validate_step_meta_drift',
        'package_step', p_package_id::text || ':' || v_step.step_key,
        'ok', v_action_detail,
        jsonb_build_object(
          'package_id', p_package_id,
          'step_key', v_step.step_key,
          'artifact_count', v_artifact_count,
          'threshold', v_threshold,
          'actor', v_uid
        )
      );

    ELSE
      v_demoted := v_demoted + 1;
      v_action_detail := format('Step %s: artifacts missing (%s < %s) → demoted', v_step.step_key, v_artifact_count, v_threshold);

      UPDATE public.package_steps
      SET status = 'queued',
          updated_at = now(),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'demoted_at', now(),
            'demoted_reason', 'ARTIFACTS_MISSING',
            'artifact_count', v_artifact_count,
            'artifact_threshold', v_threshold,
            'validated_by', 'admin_validate_step_meta_drift'
          )
      WHERE package_id = p_package_id AND step_key = v_step.step_key;

      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'STEP_DEMOTED_NEEDS_REBUILD',
        'admin_validate_step_meta_drift',
        'package_step', p_package_id::text || ':' || v_step.step_key,
        'ok', v_action_detail,
        jsonb_build_object(
          'package_id', p_package_id,
          'step_key', v_step.step_key,
          'artifact_count', v_artifact_count,
          'threshold', v_threshold,
          'actor', v_uid
        )
      );
    END IF;
  END LOOP;

  -- If any step was demoted/skipped → ensure package is in building state
  IF (v_demoted + v_skipped) > 0 THEN
    UPDATE public.course_packages
    SET status = 'building', updated_at = now()
    WHERE id = p_package_id AND status = 'done' AND published_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'validated', v_validated,
    'demoted', v_demoted,
    'skipped_no_validator', v_skipped,
    'evaluated_at', now()
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_validate_step_meta_drift(uuid) TO authenticated, service_role;

-- ============================================================================
-- 4) enqueue_done_reaudit — extended: also run reaper + meta-drift validator
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_done_reaudit(p_cap integer DEFAULT 100, p_reason text DEFAULT 'done_reaudit_cron'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap int := GREATEST(5, LEAST(COALESCE(p_cap,100), 500));
  v_src text := COALESCE(NULLIF(p_reason,''),'done_reaudit_cron');
  v_integ int := 0;
  v_council int := 0;
  v_publish int := 0;
  v_skipped_bronze int := 0;
  v_eligible int := 0;
  v_reaper_result jsonb;
  v_drift_pkgs uuid[];
  v_drift_id uuid;
  v_drift_validated int := 0;
  v_drift_demoted int := 0;
BEGIN
  -- STEP 1: Reaper — demote status='done' with open steps back to 'building'
  v_reaper_result := public.admin_repair_done_with_open_steps(v_cap);

  -- STEP 2: Validating meta-drift backfill — for done packages with meta drift
  SELECT COALESCE(array_agg(DISTINCT cp.id), ARRAY[]::uuid[])
  INTO v_drift_pkgs
  FROM public.course_packages cp
  JOIN public.package_steps ps ON ps.package_id = cp.id
  WHERE cp.status = 'done'
    AND cp.published_at IS NULL
    AND ps.status = 'done'
    AND COALESCE(ps.meta->>'ok','false') <> 'true';

  IF array_length(v_drift_pkgs, 1) IS NOT NULL THEN
    FOREACH v_drift_id IN ARRAY v_drift_pkgs LOOP
      DECLARE
        v_r jsonb;
      BEGIN
        v_r := public.admin_validate_step_meta_drift(v_drift_id);
        v_drift_validated := v_drift_validated + COALESCE((v_r->>'validated')::int, 0);
        v_drift_demoted   := v_drift_demoted   + COALESCE((v_r->>'demoted')::int, 0)
                                              + COALESCE((v_r->>'skipped_no_validator')::int, 0);
      END;
    END LOOP;
  END IF;

  -- STEP 3: Re-run original integrity / council / auto-publish enqueue loop
  WITH base AS (
    SELECT cp.id, cp.curriculum_id,
      COALESCE(cp.integrity_passed,false) AS integ_ok,
      COALESCE(cp.council_approved,false) AS council_ok,
      COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean,false)
        OR COALESCE(cp.feature_flags->'bronze'->>'final_state','') IN ('requires_review','manual_approved')
        AS is_bronze_locked,
      EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.status = 'done'
          AND COALESCE(ps.meta->>'ok','false') <> 'true'
      ) AS has_meta_drift
    FROM public.course_packages cp
    WHERE cp.status = 'done'
      AND cp.published_at IS NULL
    ORDER BY cp.updated_at ASC
    LIMIT v_cap
  ),
  flt AS (
    SELECT * FROM base WHERE NOT is_bronze_locked AND NOT has_meta_drift
  ),
  ins_integ AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT 'package_run_integrity_check', 'pending',
      jsonb_build_object('package_id', f.id::text, 'curriculum_id', f.curriculum_id::text,
                         'reason', p_reason, 'enqueue_source', v_src),
      f.id, 'core', 65, 3
    FROM flt f
    WHERE NOT f.integ_ok
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type = 'package_run_integrity_check'
          AND jq.status IN ('pending','queued','processing','running')
          AND jq.package_id = f.id
      )
    RETURNING 1
  ),
  ins_council AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT 'package_quality_council', 'pending',
      jsonb_build_object('package_id', f.id::text, 'curriculum_id', f.curriculum_id::text,
                         'reason', p_reason, 'enqueue_source', v_src),
      f.id, 'core', 66, 3
    FROM flt f
    WHERE NOT f.council_ok
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type = 'package_quality_council'
          AND jq.status IN ('pending','queued','processing','running')
          AND jq.package_id = f.id
      )
    RETURNING 1
  ),
  ins_publish AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT 'package_auto_publish', 'pending',
      jsonb_build_object('package_id', f.id::text, 'curriculum_id', f.curriculum_id::text,
                         'reason', p_reason, 'enqueue_source', v_src),
      f.id, 'core', 60, 3
    FROM flt f
    WHERE f.integ_ok AND f.council_ok
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type = 'package_auto_publish'
          AND jq.status IN ('pending','queued','processing','running')
          AND jq.package_id = f.id
      )
    RETURNING 1
  )
  SELECT
    (SELECT COUNT(*) FROM flt),
    (SELECT COUNT(*) FROM base WHERE is_bronze_locked),
    (SELECT COUNT(*) FROM ins_integ),
    (SELECT COUNT(*) FROM ins_council),
    (SELECT COUNT(*) FROM ins_publish)
  INTO v_eligible, v_skipped_bronze, v_integ, v_council, v_publish;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('done_reaudit_cron_run', v_src, 'system', 'batch', 'ok',
    format('eligible=%s integ=%s council=%s publish=%s skip_bronze=%s reaper_repaired=%s drift_validated=%s drift_demoted=%s',
           v_eligible, v_integ, v_council, v_publish, v_skipped_bronze,
           COALESCE((v_reaper_result->>'repaired')::int,0), v_drift_validated, v_drift_demoted),
    jsonb_build_object(
      'cap', v_cap, 'enqueue_source', v_src,
      'reaper_result', v_reaper_result,
      'drift_validated', v_drift_validated,
      'drift_demoted', v_drift_demoted
    ));

  RETURN jsonb_build_object(
    'cap', v_cap,
    'eligible', v_eligible,
    'enqueued_integrity', v_integ,
    'enqueued_council', v_council,
    'enqueued_publish', v_publish,
    'skipped_bronze_locked', v_skipped_bronze,
    'reaper_repaired', COALESCE((v_reaper_result->>'repaired')::int, 0),
    'drift_validated', v_drift_validated,
    'drift_demoted', v_drift_demoted,
    'enqueue_source', v_src
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.enqueue_done_reaudit(integer, text) TO authenticated, service_role;
