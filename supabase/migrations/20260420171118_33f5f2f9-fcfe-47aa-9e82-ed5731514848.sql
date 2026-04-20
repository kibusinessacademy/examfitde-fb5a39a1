-- ============================================================================
-- P0a + P0b: Bundle→Lesson Materialization Gap (FINAL v2 — column-correct)
-- ============================================================================

-- ── P0a: Producer-Fix ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content(p_lesson_id uuid, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step text;
  v_is_placeholder boolean;
  v_is_real boolean;
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);

  SELECT step::text INTO v_step FROM public.lessons WHERE id = p_lesson_id;

  v_is_placeholder := COALESCE((p_content->>'_placeholder')::boolean, false)
                   OR COALESCE((p_content->>'_regenerating')::boolean, false);
  v_is_real := public.is_real_lesson_content(p_content, v_step);

  IF v_is_placeholder THEN
    UPDATE public.lessons
    SET content = p_content,
        status = 'placeholder'
    WHERE id = p_lesson_id;
  ELSIF v_is_real THEN
    UPDATE public.lessons
    SET content = p_content,
        content_hash = md5(p_content::text),
        generation_status = 'completed',
        status = CASE
          WHEN status IN ('published','approved') THEN status
          ELSE 'approved'
        END
    WHERE id = p_lesson_id;
  ELSE
    UPDATE public.lessons
    SET content = p_content
    WHERE id = p_lesson_id;
  END IF;

  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$function$;

COMMENT ON FUNCTION public.pipeline_write_lesson_content(uuid, jsonb) IS
'Producer-first artifact-truth: bei echtem Content wird content_hash + generation_status=''completed'' atomar mitgesetzt. Placeholder/Grey-Zone bleiben explizit nicht-completed.';


-- ── P0b: Safe-Backfill (sealed-aware) ──────────────────────────────────────
WITH backfill_candidates AS (
  SELECT l.id
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  WHERE l.step::text != 'mini_check'
    AND l.content IS NOT NULL
    AND jsonb_typeof(l.content) = 'object'
    AND public.is_real_lesson_content(l.content, l.step::text)
    AND l.content_hash IS NULL
    AND COALESCE(c.autopilot_status, '') != 'sealed'
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.job_type = 'lesson_generate_content'
        AND jq.status IN ('queued','processing','pending_enqueue')
        AND COALESCE(jq.payload->>'lesson_id', jq.batch_cursor->>'lesson_id') = l.id::text
    )
)
UPDATE public.lessons l
SET content_hash = md5(l.content::text),
    generation_status = 'completed',
    status = CASE
      WHEN l.status IN ('published','approved') THEN l.status
      ELSE 'approved'
    END
FROM backfill_candidates bc
WHERE l.id = bc.id;

INSERT INTO public.admin_actions (action, payload)
VALUES (
  'artifact_truth_backfill_lessons',
  jsonb_build_object(
    'reason', 'P0b: bundle_to_lesson_materialization_gap',
    'criteria', 'is_real_lesson_content + hash IS NULL + no active job + not sealed',
    'at', now(),
    'producer_fix', 'pipeline_write_lesson_content sets hash+status atomically'
  )
);


-- ── P0c: Versuche zurücksetzen (Zero-Progress-Guard befreien) ──────────────
UPDATE public.package_steps ps
SET attempts = 0,
    last_error = NULL,
    updated_at = now()
WHERE ps.step_key IN (
        'generate_learning_content',
        'validate_learning_content',
        'finalize_learning_content'
      )
  AND ps.status = 'queued'
  AND ps.attempts > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.job_queue jq
    WHERE jq.package_id = ps.package_id
      AND jq.job_type IN (
        'package_generate_learning_content',
        'package_validate_learning_content',
        'package_finalize_learning_content'
      )
      AND jq.status IN ('queued','processing','pending_enqueue')
  );