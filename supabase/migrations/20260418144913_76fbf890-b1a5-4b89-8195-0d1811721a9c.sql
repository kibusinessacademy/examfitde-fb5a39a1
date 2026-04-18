-- ── 1) Job-Registry: fehlende Repair-/Cluster-Jobtypen ──
INSERT INTO public.ops_job_type_registry (job_type, pool, description) VALUES
  ('regenerate_learning_content_cluster', 'default', 'Repair-Pfad: regeneriert Lesson-Cluster nach HOLLOW_LEARNING_CONTENT'),
  ('repair_learning_content',             'default', 'Repair-Pfad: gezieltes Backfill einzelner hollow Lessons'),
  ('lesson_generate_competency_bundle',   'default', 'Bundle-Erzeugung pro Kompetenz für Lesson-Generierung'),
  ('package_repair_failed_lessons',       'default', 'Repair-Pfad: behebt fehlgeschlagene Lesson-Generierungen'),
  ('council_critique_step',               'default', 'Council critique step (alias guarantee)')
ON CONFLICT (job_type) DO NOTHING;

-- ── 2) Sync-Trigger: HOLLOW_LEARNING_CONTENT Guard ──
-- Verhindert, dass generate_learning_content via Trigger blind auf done gezogen wird,
-- obwohl SSOT-Artefakte (lessons.content) noch hollow sind.
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

      -- ── HOLLOW_LEARNING_CONTENT Guard (fail-closed) ──
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
            -- Step nicht auf done ziehen — fail-closed requeue mit klarem Reason
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
                  'source_job_id', NEW.id
                ),
                updated_at = now()
            WHERE package_id = NEW.package_id
              AND step_key = v_step_key
              AND status IN ('queued', 'failed', 'enqueued', 'running');

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