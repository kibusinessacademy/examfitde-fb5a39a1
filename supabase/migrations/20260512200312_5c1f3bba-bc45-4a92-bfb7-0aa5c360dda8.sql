CREATE OR REPLACE FUNCTION public.fn_guard_dedupe_ai_exam_questions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dup int;
BEGIN
  IF NEW.ai_generated IS NOT TRUE OR NEW.question_text IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_dup
  FROM public.exam_questions
  WHERE curriculum_id = NEW.curriculum_id
    AND ai_generated = true
    AND status <> 'rejected'
    AND md5(question_text) = md5(NEW.question_text)
    AND created_at > now() - interval '24 hours';

  IF v_dup > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
    VALUES (
      'exam_question_dedupe_skip',
      'exam_question',
      'skipped',
      'duplicate_ai_question_within_24h',
      jsonb_build_object(
        'curriculum_id', NEW.curriculum_id,
        'question_text_md5', md5(NEW.question_text),
        'matched_existing_count', v_dup
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_exam_questions_ai_dedupe
  ON public.exam_questions (curriculum_id, md5(question_text))
  WHERE ai_generated = true AND status <> 'rejected';

DROP TRIGGER IF EXISTS trg_guard_dedupe_ai_exam_questions ON public.exam_questions;
CREATE TRIGGER trg_guard_dedupe_ai_exam_questions
BEFORE INSERT ON public.exam_questions
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_dedupe_ai_exam_questions();

CREATE OR REPLACE FUNCTION public.fn_guard_pool_fill_producer_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur uuid;
  v_recent int;
BEGIN
  IF NEW.job_type <> 'pool_fill_bloom_gaps' THEN
    RETURN NEW;
  END IF;

  IF COALESCE((NEW.payload->>'producer_cooldown_override')::boolean, false) THEN
    RETURN NEW;
  END IF;

  v_cur := NULLIF(NEW.payload->>'curriculum_id','')::uuid;
  IF v_cur IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_recent
  FROM public.auto_heal_log
  WHERE action_type = 'pool_fill_bloom_gaps_recent_fill_skipped'
    AND created_at > now() - interval '10 minutes'
    AND (metadata->>'curriculum_id') = v_cur::text;

  IF v_recent > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'pool_fill_bloom_gaps_producer_cooldown_skipped',
      'job_queue',
      NEW.package_id,
      'skipped',
      'producer_cooldown_active_recent_fill_skipped_within_10min',
      jsonb_build_object(
        'curriculum_id', v_cur,
        'package_id', NEW.package_id,
        'recent_skips_observed', v_recent,
        'window_minutes', 10,
        'enqueue_source', NEW.payload->>'enqueue_source',
        'job_type', NEW.job_type
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_pool_fill_producer_cooldown ON public.job_queue;
CREATE TRIGGER trg_guard_pool_fill_producer_cooldown
BEFORE INSERT ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_pool_fill_producer_cooldown();

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
VALUES (
  'migration_pool_fill_dedupe_and_cooldown_v1',
  'system',
  'ok',
  'patch_a3_db_layer',
  jsonb_build_object(
    'triggers_added', jsonb_build_array(
      'trg_guard_dedupe_ai_exam_questions',
      'trg_guard_pool_fill_producer_cooldown'
    ),
    'index_added', 'idx_exam_questions_ai_dedupe',
    'rollback_hint', 'DROP TRIGGER trg_guard_dedupe_ai_exam_questions ON exam_questions; DROP TRIGGER trg_guard_pool_fill_producer_cooldown ON job_queue; DROP INDEX idx_exam_questions_ai_dedupe;'
  )
);

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_trigger
  WHERE tgname IN ('trg_guard_dedupe_ai_exam_questions', 'trg_guard_pool_fill_producer_cooldown')
    AND NOT tgisinternal;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Smoke-Test failed: expected 2 triggers, found %', v_count;
  END IF;
END $$;