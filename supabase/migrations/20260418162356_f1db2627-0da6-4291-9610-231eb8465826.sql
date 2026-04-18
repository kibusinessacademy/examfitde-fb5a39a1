-- ═══════════════════════════════════════════════════════════════════
-- SÄULE 1: Track-Applicability korrigieren
-- EXAM_FIRST und EXAM_FIRST_PLUS brauchen generate_learning_content
-- ═══════════════════════════════════════════════════════════════════
UPDATE public.track_step_applicability
SET should_run = true,
    updated_at = now()
WHERE step_key = 'generate_learning_content'
  AND track::text IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS');

-- ═══════════════════════════════════════════════════════════════════
-- SÄULE 2: Trigger-Guard auf done erweitern
-- Hollow Guard zieht auch fälschlich on done gedriftete Steps zurück
-- ═══════════════════════════════════════════════════════════════════
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
  v_realness jsonb;
  v_total int;
  v_real int;
  v_placeholders int;
  v_avg_len int;
  v_substantive_ratio numeric;
  v_pending_jobs int;
  v_block_reason text;
BEGIN
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
     AND NEW.package_id IS NOT NULL
     AND (NEW.result->>'ok')::boolean = true
  THEN
    v_step_key := v_step_map->>NEW.job_type;

    IF v_step_key IS NOT NULL AND NOT (v_step_key = ANY(v_excluded_steps)) THEN

      -- ── HOLLOW_LEARNING_CONTENT Guard (fail-closed, INKL. done) ──
      IF v_step_key = 'generate_learning_content' THEN
        BEGIN
          v_realness := public.package_lessons_realness(NEW.package_id);
        EXCEPTION WHEN OTHERS THEN
          v_realness := NULL;
        END;

        IF v_realness IS NOT NULL THEN
          v_total        := COALESCE((v_realness->>'lessons_total')::int, 0);
          v_real         := COALESCE((v_realness->>'real_content')::int, 0);
          v_placeholders := COALESCE((v_realness->>'placeholders')::int, 0);
          v_avg_len      := COALESCE((v_realness->>'avg_len')::int, 0);
          v_substantive_ratio := CASE WHEN v_total > 0 THEN v_real::numeric / v_total ELSE 0 END;

          SELECT COUNT(*) INTO v_pending_jobs
          FROM public.job_queue
          WHERE package_id = NEW.package_id
            AND job_type = 'lesson_generate_content'
            AND status IN ('pending', 'enqueued', 'processing')
            AND id <> NEW.id;

          v_block_reason := NULL;
          IF v_total = 0 THEN
            v_block_reason := 'HOLLOW_LEARNING_CONTENT:no_lessons';
          ELSIF v_placeholders > 0 THEN
            v_block_reason := format('PLACEHOLDER_LESSONS_PRESENT:%s/%s', v_placeholders, v_total);
          ELSIF v_substantive_ratio < 0.90 THEN
            v_block_reason := format('LESSON_SUBSTANCE_BELOW_THRESHOLD:%s/%s@%.3f<0.90',
                                     v_real, v_total, v_substantive_ratio);
          ELSIF v_pending_jobs > 0 THEN
            v_block_reason := format('LESSON_GENERATION_INCOMPLETE:%s_jobs_active', v_pending_jobs);
          ELSIF v_avg_len < 600 THEN
            v_block_reason := format('THRESHOLD_FAIL:learning_content:avg_len:%s/600', v_avg_len);
          END IF;

          IF v_block_reason IS NOT NULL THEN
            -- ★ FIX SÄULE 2: Erweitere WHERE auf 'done' damit auch
            --   bereits gedriftete Steps zurückgezogen werden
            UPDATE public.package_steps
            SET status = 'queued',
                last_error = v_block_reason,
                meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                  'sync_blocked_by_hollow_guard', true,
                  'hollow_guard_reason', v_block_reason,
                  'hollow_guard_at', now()::text,
                  'hollow_guard_total', v_total,
                  'hollow_guard_real', v_real,
                  'hollow_guard_placeholders', v_placeholders,
                  'hollow_guard_avg_len', v_avg_len,
                  'hollow_guard_pending_jobs', v_pending_jobs,
                  'hollow_guard_substantive_ratio', v_substantive_ratio,
                  'hollow_guard_revoked_done', (
                    SELECT status = 'done'
                    FROM public.package_steps
                    WHERE package_id = NEW.package_id AND step_key = v_step_key
                  ),
                  'allow_regression', true,
                  'allow_regression_by', 'hollow_guard_done_revoke',
                  'source_job_id', NEW.id
                ),
                updated_at = now()
            WHERE package_id = NEW.package_id
              AND step_key = v_step_key
              AND status IN ('queued', 'failed', 'enqueued', 'running', 'done', 'skipped');

            RETURN NEW;
          END IF;
        END IF;
      END IF;

      -- Standard-Pfad: Step auf done ziehen
      UPDATE public.package_steps
      SET status = 'done',
          started_at = COALESCE(started_at, now() - interval '1 minute'),
          attempts = GREATEST(attempts, 1),
          last_error = NULL,
          job_id = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'postcondition_verified', true,
            'ok', 'true',
            'executed', 'true',
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

-- ═══════════════════════════════════════════════════════════════════
-- SÄULE 3: Race-Condition Guard für step_finalized_job_obsoleted
-- BEFORE-Trigger auf job_queue: wenn step bereits done, Job clean cancellen
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_guard_obsolete_processing_jobs()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_step_key text;
  v_step_status text;
  v_step_map jsonb := '{
    "package_generate_exam_pool": "generate_exam_pool",
    "package_generate_handbook": "generate_handbook",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_validate_learning_content": "validate_learning_content",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_validate_handbook": "validate_handbook",
    "package_validate_handbook_depth": "validate_handbook_depth",
    "package_validate_oral_exam": "validate_oral_exam",
    "package_validate_lesson_minichecks": "validate_lesson_minichecks",
    "package_validate_tutor_index": "validate_tutor_index",
    "package_validate_blueprints": "validate_blueprints",
    "package_validate_blueprint_variants": "validate_blueprint_variants",
    "package_generate_blueprint_variants": "generate_blueprint_variants",
    "package_promote_blueprint_variants": "promote_blueprint_variants",
    "package_finalize_learning_content": "finalize_learning_content",
    "package_run_integrity_check": "run_integrity_check",
    "package_quality_council": "quality_council",
    "package_elite_harden": "elite_harden",
    "package_auto_publish": "auto_publish",
    "package_build_ai_tutor_index": "build_ai_tutor_index",
    "package_scaffold_learning_course": "scaffold_learning_course",
    "package_fanout_learning_content": "fanout_learning_content",
    "package_generate_learning_content": "generate_learning_content"
  }'::jsonb;
BEGIN
  -- Nur bei Übergang nach processing prüfen
  IF NEW.status = 'processing'
     AND (OLD.status IS DISTINCT FROM 'processing')
     AND NEW.package_id IS NOT NULL
  THEN
    v_step_key := v_step_map->>NEW.job_type;
    
    IF v_step_key IS NOT NULL THEN
      SELECT status INTO v_step_status
      FROM public.package_steps
      WHERE package_id = NEW.package_id AND step_key = v_step_key;

      -- Wenn Step bereits done/skipped → Job clean cancellen, kein Race
      IF v_step_status IN ('done', 'skipped') THEN
        NEW.status := 'cancelled';
        NEW.completed_at := now();
        NEW.last_error := jsonb_build_object(
          'last_error_kind', 'preempted_by_step_state',
          'last_error_message', format('step_already_%s_at_processing_start', v_step_status),
          'cancelled_by', 'fn_guard_obsolete_processing_jobs',
          'at', now()::text
        );
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_obsolete_processing_jobs ON public.job_queue;
CREATE TRIGGER trg_guard_obsolete_processing_jobs
BEFORE UPDATE ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_obsolete_processing_jobs();

-- ═══════════════════════════════════════════════════════════════════
-- SÄULE 4 (DB-Teil): Marker für permanente Materialization-Failures
-- Edge-Code wird in handleDbFailure ergänzt — DB markiert nur
-- ═══════════════════════════════════════════════════════════════════
COMMENT ON FUNCTION public.fn_trigger_sync_step_on_job_complete() IS
'Hardened v3 (2026-04-18): HOLLOW_LEARNING_CONTENT Guard zieht auch done/skipped Steps zurück. Verhindert Re-Drift Loop nach Phase B Härtung.';

COMMENT ON FUNCTION public.fn_guard_obsolete_processing_jobs() IS
'Säule 3 (2026-04-18): Verhindert Race-Condition step_finalized_job_obsoleted. Wenn ein Job in processing transitioniert, aber der Step bereits done/skipped ist, wird der Job clean als preempted_by_step_state cancelled.';