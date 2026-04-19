-- Säule 1: Heilung 19 Pakete — alle 3 downstream Steps reset
UPDATE public.package_steps ps
SET
  status = 'queued',
  attempts = 0,
  last_error = NULL,
  updated_at = now(),
  meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
    'allow_regression', true,
    'allow_regression_by', 'ops_force_reset',
    'reset_reason', 'ghost_completion_pending_lessons_detected',
    'reset_at', now()::text,
    'manual_bypass_at', now()::text,
    'manual_bypass_reason', 'forensic_heal_ghost_completion',
    'allow_ghost_completion', false
  ) - 'reason_codes' - 'guard_state' - 'stall_reason_code'
WHERE ps.package_id = ANY(ARRAY[
    'd2000001-0009-4000-8000-000000000001','d7fd81c3-283e-4270-acef-812b08501442','bd19860b-7efb-46aa-b35e-708c0dc90b2c',
    'ffc70d6c-89d1-44a3-8885-3bedfe76a393','bf021304-55e5-4736-ba98-8750c7f9c59d','a369b56b-f39d-4be4-9318-5ecc21d9289e',
    '180c24a9-eba7-4159-ada8-140cee76f947','c0d94e63-1ae1-4b0d-b23a-2f19ce7a7c5a','a320f1cb-7b20-4e69-9838-7b02df68b69d',
    'af1edc56-e412-4dc0-93e0-969d553ab242','176f51ad-fe34-596e-9b3d-d1c9cd23b0a9','beb241ed-58dc-4ddc-930d-ca041dbde99f',
    'dd000001-0005-4000-8000-000000000001','d2000000-0001-4000-8000-000000000001','d2000000-0006-4000-8000-000000000001',
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','ba96f6d9-c638-4bf3-aaca-3465ac363e8b','3e070545-c555-417a-a047-c7541ebb2a7c',
    '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081'
  ]::uuid[])
  AND ps.step_key IN ('generate_learning_content', 'validate_learning_content', 'finalize_learning_content');

-- Cancel hängende Jobs
UPDATE public.job_queue
SET
  status = 'cancelled',
  completed_at = now(),
  updated_at = now(),
  last_error = jsonb_build_object(
    'last_error_kind', 'MANUAL_CANCEL_FOR_HEAL',
    'last_error_message', 'Cancelled during forensic healing after ghost completion detection'
  ),
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'cancel_reason', 'forensic_heal_ghost_completion',
    'cancelled_at', now()::text
  )
WHERE package_id = ANY(ARRAY[
    'd2000001-0009-4000-8000-000000000001','d7fd81c3-283e-4270-acef-812b08501442','bd19860b-7efb-46aa-b35e-708c0dc90b2c',
    'ffc70d6c-89d1-44a3-8885-3bedfe76a393','bf021304-55e5-4736-ba98-8750c7f9c59d','a369b56b-f39d-4be4-9318-5ecc21d9289e',
    '180c24a9-eba7-4159-ada8-140cee76f947','c0d94e63-1ae1-4b0d-b23a-2f19ce7a7c5a','a320f1cb-7b20-4e69-9838-7b02df68b69d',
    'af1edc56-e412-4dc0-93e0-969d553ab242','176f51ad-fe34-596e-9b3d-d1c9cd23b0a9','beb241ed-58dc-4ddc-930d-ca041dbde99f',
    'dd000001-0005-4000-8000-000000000001','d2000000-0001-4000-8000-000000000001','d2000000-0006-4000-8000-000000000001',
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','ba96f6d9-c638-4bf3-aaca-3465ac363e8b','3e070545-c555-417a-a047-c7541ebb2a7c',
    '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081'
  ]::uuid[])
  AND job_type IN ('package_generate_learning_content', 'package_validate_learning_content', 'package_finalize_learning_content')
  AND status IN ('pending','queued','processing','running','batch_pending');

INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
VALUES (
  'forensic_heal_ghost_completion',
  'course_packages',
  ARRAY[
    'd2000001-0009-4000-8000-000000000001','d7fd81c3-283e-4270-acef-812b08501442','bd19860b-7efb-46aa-b35e-708c0dc90b2c',
    'ffc70d6c-89d1-44a3-8885-3bedfe76a393','bf021304-55e5-4736-ba98-8750c7f9c59d','a369b56b-f39d-4be4-9318-5ecc21d9289e',
    '180c24a9-eba7-4159-ada8-140cee76f947','c0d94e63-1ae1-4b0d-b23a-2f19ce7a7c5a','a320f1cb-7b20-4e69-9838-7b02df68b69d',
    'af1edc56-e412-4dc0-93e0-969d553ab242','176f51ad-fe34-596e-9b3d-d1c9cd23b0a9','beb241ed-58dc-4ddc-930d-ca041dbde99f',
    'dd000001-0005-4000-8000-000000000001','d2000000-0001-4000-8000-000000000001','d2000000-0006-4000-8000-000000000001',
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','ba96f6d9-c638-4bf3-aaca-3465ac363e8b','3e070545-c555-417a-a047-c7541ebb2a7c',
    '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081'
  ],
  jsonb_build_object(
    'reason', 'ghost_completion_19_packages',
    'detection_query', 'pending_lessons > 0 AND generate_learning_content.status = done',
    'action', 'reset_3_steps_and_cancel_jobs'
  )
);

-- Säule 2: Systemischer DB-Trigger gegen Ghost-Completion
CREATE OR REPLACE FUNCTION public.fn_guard_generate_learning_content_ghost_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_count INTEGER;
  v_total_count INTEGER;
  v_course_id UUID;
BEGIN
  IF NEW.step_key <> 'generate_learning_content' THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status = 'done' THEN RETURN NEW; END IF;
  IF (NEW.meta->>'allow_ghost_completion')::boolean = true THEN RETURN NEW; END IF;

  SELECT course_id INTO v_course_id FROM public.course_packages WHERE id = NEW.package_id;
  IF v_course_id IS NULL THEN RETURN NEW; END IF;

  SELECT
    COUNT(*) FILTER (WHERE l.generation_status = 'pending' OR l.content IS NULL),
    COUNT(*)
  INTO v_pending_count, v_total_count
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id AND l.step <> 'mini_check';

  IF v_pending_count > 0 AND v_total_count > 0 THEN
    NEW.status := 'queued';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'ops_force_reset',
      'ghost_completion_blocked_at', now()::text,
      'ghost_completion_pending_count', v_pending_count,
      'ghost_completion_total_count', v_total_count,
      'ghost_completion_reason', 'pending_lessons_present_at_finalize_attempt'
    );
    RAISE NOTICE 'GHOST_COMPLETION_BLOCKED: pkg=% pending=%/% — kept step queued',
      NEW.package_id, v_pending_count, v_total_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_glc_ghost_completion ON public.package_steps;
CREATE TRIGGER trg_guard_glc_ghost_completion
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_generate_learning_content_ghost_completion();

COMMENT ON FUNCTION public.fn_guard_generate_learning_content_ghost_completion IS
  'Verhindert Ghost-Completion: generate_learning_content darf nicht done werden, solange Lessons pending sind.';