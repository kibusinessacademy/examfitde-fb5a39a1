
-- ============================================================================
-- 1) fn_guard_hollow_done: extend with generate_blueprint_variants artifact gate
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_guard_hollow_done()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_critical_steps text[] := ARRAY[
    'generate_learning_content','generate_exam_pool','generate_handbook',
    'generate_lesson_minichecks','generate_oral_exam','build_ai_tutor_index',
    'auto_seed_exam_blueprints'
  ];
  v_blueprint_count integer;
  v_variant_count integer;
  v_curriculum_id uuid;
  v_source text := COALESCE(current_setting('app.source_fn', true), 'unknown');
BEGIN
  IF NEW.status='done' AND (OLD.status IS DISTINCT FROM 'done') THEN

    -- ----- auto_seed_exam_blueprints (existing, non-bypassable) -----
    IF NEW.step_key='auto_seed_exam_blueprints' THEN
      SELECT cp.curriculum_id INTO v_curriculum_id
        FROM public.course_packages cp WHERE cp.id=NEW.package_id;
      SELECT COUNT(*) INTO v_blueprint_count
        FROM public.question_blueprints
        WHERE curriculum_id = v_curriculum_id
          AND deprecated_at IS NULL
          AND status::text <> 'deprecated';
      IF COALESCE(v_blueprint_count,0)=0 THEN
        BEGIN
          INSERT INTO public.auto_heal_log(
            action_type, trigger_source, target_type, target_id,
            result_status, result_detail, metadata
          ) VALUES (
            'standalone_reconciler_hollow_completion_blocked',
            v_source, 'package_step', NEW.package_id::text,
            'blocked', 'auto_seed_exam_blueprints: 0 active question_blueprints',
            jsonb_build_object(
              'package_id', NEW.package_id,
              'step_key', NEW.step_key,
              'curriculum_id', v_curriculum_id,
              'reason', 'HOLLOW_COMPLETION_NO_BLUEPRINTS',
              'source_fn', v_source,
              'meta', NEW.meta
            )
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;
        RAISE EXCEPTION
          'NON_BYPASSABLE_HOLLOW_DONE: auto_seed_exam_blueprints cannot be done with 0 active question_blueprints (package_id=%, curriculum_id=%). No bypass allowed.',
          NEW.package_id, v_curriculum_id
        USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END IF;

    -- ----- NEW: generate_blueprint_variants (artifact-aware, non-bypassable) -----
    IF NEW.step_key = 'generate_blueprint_variants' THEN
      SELECT cp.curriculum_id INTO v_curriculum_id
        FROM public.course_packages cp WHERE cp.id = NEW.package_id;

      SELECT COUNT(*) INTO v_variant_count
        FROM public.exam_question_variants v
        JOIN public.question_blueprints qb ON qb.id = v.blueprint_id
       WHERE qb.curriculum_id = v_curriculum_id;

      IF COALESCE(v_variant_count, 0) = 0 THEN
        BEGIN
          INSERT INTO public.auto_heal_log(
            action_type, trigger_source, target_type, target_id,
            result_status, result_detail, metadata
          ) VALUES (
            'standalone_reconciler_hollow_completion_blocked',
            v_source, 'package_step', NEW.package_id::text,
            'blocked', 'generate_blueprint_variants: 0 exam_question_variants for curriculum',
            jsonb_build_object(
              'package_id', NEW.package_id,
              'step_key', NEW.step_key,
              'curriculum_id', v_curriculum_id,
              'variant_count', v_variant_count,
              'reason', 'HOLLOW_COMPLETION_NO_VARIANTS',
              'source_fn', v_source,
              'meta_ok', NEW.meta->>'ok',
              'meta_executed', NEW.meta->>'executed',
              'meta', NEW.meta
            )
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;

        RAISE EXCEPTION
          'HOLLOW_COMPLETION_NO_VARIANTS: generate_blueprint_variants cannot be done with 0 variants (package_id=%, curriculum_id=%, source=%). Reset step to queued and run real producer.',
          NEW.package_id, v_curriculum_id, v_source
        USING ERRCODE='check_violation',
              HINT='Reconciler must verify exam_question_variants exist before promoting step to done.';
      END IF;
      RETURN NEW;
    END IF;

    -- ----- existing critical steps (bypass-allowed) -----
    IF NEW.step_key=ANY(v_critical_steps) THEN
      IF COALESCE((NEW.meta->>'postcondition_verified')::boolean,false) THEN RETURN NEW; END IF;
      IF COALESCE((NEW.meta->>'allow_regression')::boolean,false) THEN RETURN NEW; END IF;
      IF COALESCE(NEW.exception_approved,false) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'HOLLOW_DONE_BLOCKED: step "%" cannot transition to done without postcondition_verified=true.', NEW.step_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 2) fn_debounce_exam_rebalance: audit silent drops to auto_heal_log
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_debounce_exam_rebalance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _recent_count int;
BEGIN
  IF NEW.job_type != 'package_exam_rebalance' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO _recent_count
  FROM job_queue
  WHERE package_id = NEW.package_id
    AND job_type = 'package_exam_rebalance'
    AND created_at > now() - interval '10 minutes'
    AND status IN ('pending', 'processing', 'completed');

  IF _recent_count > 0 THEN
    BEGIN
      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id,
        result_status, result_detail, metadata
      ) VALUES (
        'job_queue_insert_debounced',
        'fn_debounce_exam_rebalance',
        'job_queue', COALESCE(NEW.package_id::text,'unknown'),
        'skipped',
        'duplicate package_exam_rebalance within 10min',
        jsonb_build_object(
          'job_type', NEW.job_type,
          'package_id', NEW.package_id,
          'recent_count', _recent_count,
          'window_minutes', 10,
          'enqueue_source', NEW.payload->>'enqueue_source',
          'reason', 'DEBOUNCE_DUPLICATE_REBALANCE'
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE LOG 'DEBOUNCE: Skipping duplicate package_exam_rebalance for package % (% recent)',
      NEW.package_id, _recent_count;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 3) fn_debounce_integrity_check: audit silent drops to auto_heal_log
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_debounce_integrity_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _recent_count int;
  _is_bronze boolean;
BEGIN
  IF NEW.job_type != 'package_run_integrity_check' THEN
    RETURN NEW;
  END IF;

  _is_bronze := COALESCE(NEW.payload->>'_origin','') = 'bronze_targeted_repair'
             OR COALESCE(NEW.meta->>'enqueue_source','') = 'bronze_targeted_repair'
             OR COALESCE(NEW.meta->>'bronze_repair_followup','') = 'true';
  IF _is_bronze THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO _recent_count
  FROM job_queue
  WHERE package_id = NEW.package_id
    AND job_type = 'package_run_integrity_check'
    AND created_at > now() - interval '15 minutes'
    AND status IN ('pending', 'processing', 'completed', 'cancelled');

  IF _recent_count > 0 THEN
    BEGIN
      INSERT INTO public.auto_heal_log(
        action_type, trigger_source, target_type, target_id,
        result_status, result_detail, metadata
      ) VALUES (
        'job_queue_insert_debounced',
        'fn_debounce_integrity_check',
        'job_queue', COALESCE(NEW.package_id::text,'unknown'),
        'skipped',
        'duplicate package_run_integrity_check within 15min',
        jsonb_build_object(
          'job_type', NEW.job_type,
          'package_id', NEW.package_id,
          'recent_count', _recent_count,
          'window_minutes', 15,
          'enqueue_source', NEW.payload->>'enqueue_source',
          'reason', 'DEBOUNCE_DUPLICATE_INTEGRITY_CHECK'
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE LOG 'DEBOUNCE: Skipping duplicate package_run_integrity_check for package % (% recent)',
      NEW.package_id, _recent_count;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- Smoke (read-only): verify guard def covers generate_blueprint_variants
-- ============================================================================
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname='fn_guard_hollow_done';
  IF v_def NOT LIKE '%generate_blueprint_variants%' OR v_def NOT LIKE '%HOLLOW_COMPLETION_NO_VARIANTS%' THEN
    RAISE EXCEPTION 'SMOKE_FAIL: fn_guard_hollow_done missing generate_blueprint_variants gate';
  END IF;
END $$;
