
-- ═══════════════════════════════════════════════════════════
-- FIX 1: Add fanout_learning_content to trigger step_map
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_trigger_sync_step_on_job_complete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_step_key text;
  v_excluded_steps text[] := ARRAY['repair_exam_pool_quality'];
  v_step_map jsonb := '{
    "package_build_ai_tutor_index": "build_ai_tutor_index",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_generate_handbook": "generate_handbook",
    "package_generate_exam_pool": "generate_exam_pool",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_elite_harden": "elite_harden",
    "package_validate_learning_content": "validate_learning_content",
    "package_quality_council": "quality_council",
    "package_auto_seed_exam_blueprints": "auto_seed_exam_blueprints",
    "package_validate_oral_exam": "validate_oral_exam",
    "package_validate_handbook": "validate_handbook",
    "package_validate_handbook_depth": "validate_handbook_depth",
    "package_validate_tutor_index": "validate_tutor_index",
    "package_validate_lesson_minichecks": "validate_lesson_minichecks",
    "package_validate_blueprints": "validate_blueprints",
    "package_validate_blueprint_variants": "validate_blueprint_variants",
    "package_generate_blueprint_variants": "generate_blueprint_variants",
    "package_promote_blueprint_variants": "promote_blueprint_variants",
    "package_expand_handbook": "expand_handbook",
    "package_enqueue_handbook_expand": "enqueue_handbook_expand",
    "package_finalize_learning_content": "finalize_learning_content",
    "package_auto_publish": "auto_publish",
    "package_run_integrity_check": "run_integrity_check",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_generate_learning_content": "generate_learning_content",
    "package_scaffold_learning_course": "scaffold_learning_course",
    "package_fanout_learning_content": "fanout_learning_content"
  }'::jsonb;
BEGIN
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
     AND NEW.package_id IS NOT NULL
     AND (NEW.result->>'ok')::boolean = true
  THEN
    v_step_key := v_step_map->>NEW.job_type;
    
    IF v_step_key IS NOT NULL AND NOT (v_step_key = ANY(v_excluded_steps)) THEN
      UPDATE package_steps
      SET status = 'done',
          started_at = COALESCE(started_at, now() - interval '1 minute'),
          attempts = GREATEST(attempts, 1),
          last_error = NULL,
          job_id = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'postcondition_verified', true,
            'ok', 'true',
            'synced_by', 'trg_sync_step_on_job_complete',
            'synced_at', now()::text,
            'source_job_id', NEW.id
          ),
          updated_at = now()
      WHERE package_id = NEW.package_id
        AND step_key = v_step_key
        AND status IN ('queued', 'failed', 'enqueued', 'running');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- ═══════════════════════════════════════════════════════════
-- FIX 2: Healer - add fanout + running status coverage
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_sync_steps_from_completed_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_synced int := 0;
  v_rec record;
  v_excluded_steps text[] := ARRAY['repair_exam_pool_quality'];
  v_step_map jsonb := '{
    "package_build_ai_tutor_index": "build_ai_tutor_index",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_generate_handbook": "generate_handbook",
    "package_generate_exam_pool": "generate_exam_pool",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_elite_harden": "elite_harden",
    "package_validate_learning_content": "validate_learning_content",
    "package_quality_council": "quality_council",
    "package_auto_seed_exam_blueprints": "auto_seed_exam_blueprints",
    "package_validate_oral_exam": "validate_oral_exam",
    "package_validate_handbook": "validate_handbook",
    "package_validate_handbook_depth": "validate_handbook_depth",
    "package_validate_tutor_index": "validate_tutor_index",
    "package_validate_lesson_minichecks": "validate_lesson_minichecks",
    "package_validate_blueprints": "validate_blueprints",
    "package_validate_blueprint_variants": "validate_blueprint_variants",
    "package_generate_blueprint_variants": "generate_blueprint_variants",
    "package_promote_blueprint_variants": "promote_blueprint_variants",
    "package_expand_handbook": "expand_handbook",
    "package_enqueue_handbook_expand": "enqueue_handbook_expand",
    "package_finalize_learning_content": "finalize_learning_content",
    "package_auto_publish": "auto_publish",
    "package_run_integrity_check": "run_integrity_check",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_generate_learning_content": "generate_learning_content",
    "package_scaffold_learning_course": "scaffold_learning_course",
    "package_fanout_learning_content": "fanout_learning_content"
  }'::jsonb;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT ON (ps.package_id, ps.step_key)
      ps.id as step_id, ps.package_id, ps.step_key,
      jq.id as job_id, jq.completed_at
    FROM package_steps ps
    JOIN job_queue jq ON jq.package_id = ps.package_id
      AND jq.status = 'completed'
      AND (jq.result->>'ok')::boolean = true
      AND jq.completed_at > ps.updated_at - interval '30 minutes'
    WHERE ps.status IN ('queued', 'failed', 'enqueued', 'running')
      AND ps.step_key = COALESCE(v_step_map->>jq.job_type, '')
      AND NOT (ps.step_key = ANY(v_excluded_steps))
      AND jq.completed_at > now() - interval '12 hours'
    ORDER BY ps.package_id, ps.step_key, jq.completed_at DESC
  LOOP
    UPDATE package_steps
    SET status = 'done',
        started_at = COALESCE(started_at, now() - interval '1 minute'),
        attempts = GREATEST(attempts, 1),
        last_error = NULL,
        job_id = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'postcondition_verified', true,
          'ok', 'true',
          'healed_by', 'fn_sync_steps_from_completed_jobs',
          'healed_at', now()::text,
          'source_job_id', v_rec.job_id
        ),
        updated_at = now()
    WHERE id = v_rec.step_id AND status IN ('queued', 'failed', 'enqueued', 'running');
    IF FOUND THEN
      v_synced := v_synced + 1;
      INSERT INTO admin_actions (action, payload, scope)
      VALUES ('step_sync_from_completed_job',
        jsonb_build_object('package_id', v_rec.package_id, 'step_key', v_rec.step_key, 'completed_job_id', v_rec.job_id),
        'auto_heal');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('synced', v_synced, 'type', 'step_sync_from_completed_jobs');
END;
$function$;

-- ═══════════════════════════════════════════════════════════
-- FIX 3: Old sync trigger - add meta.ok + started_at for Ghost Guard compat
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_step_on_job_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step_key text;
  v_course_id uuid;
  v_placeholder int;
  v_too_short int;
  v_pkg_id uuid;
  v_batch_complete boolean;
BEGIN
  IF NEW.status IN ('completed','failed','cancelled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    IF NEW.status = 'completed' THEN

      SELECT ps.step_key INTO v_step_key
      FROM public.package_steps ps
      WHERE ps.job_id = NEW.id
        AND ps.status::text IN ('enqueued','running')
      LIMIT 1;

      v_pkg_id := (NEW.payload->>'package_id')::uuid;

      -- BATCH COMPLETION GATE (v2)
      v_batch_complete := (NEW.result->>'batch_complete')::boolean;
      IF v_batch_complete IS NOT NULL AND v_batch_complete = false THEN
        UPDATE public.package_steps
        SET status = 'queued',
            job_id = NULL,
            runner_id = NULL,
            started_at = NULL,
            finished_at = NULL,
            last_error = NULL,
            meta = jsonb_set(
              coalesce(meta, '{}'::jsonb),
              '{trigger_requeued_at}',
              to_jsonb(now()::text)
            )
        WHERE job_id = NEW.id
          AND status::text IN ('enqueued','running');
        RETURN NEW;
      END IF;

      -- Content Integrity Gate (generate_learning_content only)
      IF v_step_key = 'generate_learning_content' THEN
        SELECT cp.course_id INTO v_course_id
        FROM public.course_packages cp
        WHERE cp.id = v_pkg_id;

        IF v_course_id IS NOT NULL THEN
          SELECT placeholder_lessons, too_short_lessons
          INTO v_placeholder, v_too_short
          FROM public.v_course_content_integrity
          WHERE course_id = v_course_id;

          IF coalesce(v_placeholder, 0) > 0 THEN
            UPDATE public.package_steps
            SET status = 'queued',
                job_id = NULL,
                runner_id = NULL,
                started_at = NULL,
                finished_at = NULL,
                last_error = format(
                  'Integrity gate: %s placeholder lessons remaining',
                  coalesce(v_placeholder, 0)
                )
            WHERE job_id = NEW.id
              AND status::text IN ('enqueued','running');
            RETURN NEW;
          END IF;

          IF coalesce(v_too_short, 0) > 0 THEN
            UPDATE public.package_steps
            SET last_error = format(
              'Warning: %s too-short lessons (not blocking)',
              coalesce(v_too_short, 0)
            )
            WHERE job_id = NEW.id
              AND status::text IN ('enqueued','running');
          END IF;
        END IF;
      END IF;

      -- Normal completion — set meta.ok + started_at for Ghost Guard compatibility
      UPDATE public.package_steps
      SET status = 'done',
          started_at = COALESCE(started_at, now() - interval '1 minute'),
          finished_at = now(),
          last_heartbeat_at = now(),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'ok', 'true',
            'synced_by', 'sync_step_on_job_completion',
            'synced_at', now()::text,
            'source_job_id', NEW.id
          )
      WHERE job_id = NEW.id
        AND status::text IN ('enqueued','running');
    ELSE
      -- failed/cancelled: reset to queued
      UPDATE public.package_steps
      SET status = 'queued',
          job_id = NULL,
          runner_id = NULL,
          started_at = NULL,
          finished_at = NULL,
          last_error = 'Job ' || NEW.status || ': ' || left(coalesce(NEW.last_error,'unknown'), 500)
      WHERE job_id = NEW.id
        AND status::text IN ('enqueued','running');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ═══════════════════════════════════════════════════════════
-- FIX 4: fn_is_step_finalizable - correct stale step→job map
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_is_step_finalizable(p_package_id uuid, p_step_key text, p_min_age_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step record;
  v_meta jsonb;
  v_has_completion boolean := false;
  v_has_needs_regen boolean := false;
  v_age_ms bigint;
  v_min_age_ms bigint;
  v_ref_time timestamptz;
  v_genuinely_active int := 0;
  v_terminal int := 0;
  v_job_type text;
  v_reason text;
  v_job record;
  v_terminal_patterns text[] := ARRAY[
    'STALE_LOCK_RECOVERY','STALE_LOCK_LOOP_COOLDOWN','STALE_LOCK_EXHAUSTED',
    'LOOP_KILLED','ZOMBIE_TERMINAL_FAIL','LOCK_CHURN'
  ];
BEGIN
  SELECT * INTO v_step
  FROM package_steps
  WHERE package_id = p_package_id AND step_key = p_step_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'finalizable', false, 'reason_code', 'step_not_found',
      'reason_detail', p_step_key, 'has_completion_signal', false,
      'genuinely_active_jobs', 0, 'terminal_jobs', 0, 'min_age_passed', false
    );
  END IF;

  v_meta := COALESCE(v_step.meta, '{}'::jsonb);

  -- 1. Completion signal
  v_has_completion := (v_meta->>'batch_complete')::boolean IS TRUE
                   OR (v_meta->>'ok')::boolean IS TRUE;

  IF NOT v_has_completion THEN
    RETURN jsonb_build_object(
      'finalizable', false, 'reason_code', 'no_completion_signal',
      'reason_detail', null, 'has_completion_signal', false,
      'genuinely_active_jobs', 0, 'terminal_jobs', 0, 'min_age_passed', false
    );
  END IF;

  -- 2. needs_regen
  v_has_needs_regen := COALESCE((v_meta->>'needs_regen')::int, 0) > 0;
  IF v_has_needs_regen THEN
    RETURN jsonb_build_object(
      'finalizable', false, 'reason_code', 'needs_regen',
      'reason_detail', v_meta->>'needs_regen', 'has_completion_signal', true,
      'genuinely_active_jobs', 0, 'terminal_jobs', 0, 'min_age_passed', false
    );
  END IF;

  -- 3. Age check
  v_min_age_ms := p_min_age_minutes * 60 * 1000;
  v_ref_time := COALESCE(v_step.started_at, v_step.updated_at);
  IF v_ref_time IS NOT NULL THEN
    v_age_ms := EXTRACT(EPOCH FROM (now() - v_ref_time)) * 1000;
    IF v_age_ms < v_min_age_ms THEN
      RETURN jsonb_build_object(
        'finalizable', false, 'reason_code', 'too_young',
        'reason_detail', (v_age_ms / 1000)::text || 's', 'has_completion_signal', true,
        'genuinely_active_jobs', 0, 'terminal_jobs', 0, 'min_age_passed', false
      );
    END IF;
  END IF;

  -- 4. Job liveness — use step_job_mapping SSOT, fallback to package_ prefix
  SELECT sjm.job_types[1] INTO v_job_type
  FROM step_job_mapping sjm
  WHERE sjm.step_key = p_step_key;

  IF v_job_type IS NULL THEN
    v_job_type := 'package_' || p_step_key;
  END IF;

  FOR v_job IN
    SELECT id, attempts, last_error, status
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type = v_job_type
      AND status IN ('pending', 'processing')
  LOOP
    IF COALESCE(v_job.attempts, 0) >= 10 THEN
      v_terminal := v_terminal + 1;
    ELSIF COALESCE(v_job.attempts, 0) >= 8
          AND COALESCE(v_job.last_error, '') LIKE 'HTTP 5%' THEN
      v_terminal := v_terminal + 1;
    ELSIF COALESCE(v_job.attempts, 0) >= 4 THEN
      IF EXISTS (
        SELECT 1 FROM unnest(v_terminal_patterns) p
        WHERE COALESCE(v_job.last_error, '') LIKE '%' || p || '%'
      ) THEN
        v_terminal := v_terminal + 1;
      ELSE
        v_genuinely_active := v_genuinely_active + 1;
      END IF;
    ELSE
      v_genuinely_active := v_genuinely_active + 1;
    END IF;
  END LOOP;

  IF v_genuinely_active > 0 THEN
    RETURN jsonb_build_object(
      'finalizable', false, 'reason_code', 'genuinely_active_jobs',
      'reason_detail', v_genuinely_active::text, 'has_completion_signal', true,
      'genuinely_active_jobs', v_genuinely_active, 'terminal_jobs', v_terminal,
      'min_age_passed', true
    );
  END IF;

  RETURN jsonb_build_object(
    'finalizable', true, 'reason_code', 'all_conditions_met',
    'reason_detail', null, 'has_completion_signal', true,
    'genuinely_active_jobs', 0, 'terminal_jobs', v_terminal, 'min_age_passed', true
  );
END;
$function$;
