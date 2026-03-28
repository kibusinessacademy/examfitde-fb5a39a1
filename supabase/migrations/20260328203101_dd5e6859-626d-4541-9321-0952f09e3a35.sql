
BEGIN;

CREATE OR REPLACE FUNCTION public.map_reason_codes_to_heal_action(p_reason_codes text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_reason_codes IS NULL OR array_length(p_reason_codes, 1) IS NULL THEN
    RETURN 'manual_review';
  END IF;
  IF 'too_few_questions' = ANY(p_reason_codes) OR 'low_question_buffer' = ANY(p_reason_codes) THEN
    RETURN 'repair_exam_pool';
  END IF;
  IF 'no_lessons' = ANY(p_reason_codes) OR 'low_lesson_count' = ANY(p_reason_codes) THEN
    RETURN 'repair_learning_content';
  END IF;
  IF 'missing_tutor_index' = ANY(p_reason_codes) THEN
    RETURN 'repair_tutor_index';
  END IF;
  IF 'integrity_failed' = ANY(p_reason_codes) THEN
    RETURN 'rerun_integrity';
  END IF;
  IF 'council_not_approved' = ANY(p_reason_codes) THEN
    RETURN 'rerun_quality_council';
  END IF;
  RETURN 'manual_review';
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_auto_heal_for_test_run(p_test_run_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run record;
  v_heal_action text;
  v_queue_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.admin_course_test_runs WHERE id = p_test_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Test run not found'; END IF;
  IF v_run.test_status <> 'issue_found' THEN RAISE EXCEPTION 'Auto-heal only for issue_found'; END IF;

  v_heal_action := public.map_reason_codes_to_heal_action(v_run.issue_codes);

  INSERT INTO public.admin_course_auto_heal_queue (
    package_id, curriculum_id, source_test_run_id, source, reason_codes, heal_action, status, notes
  ) VALUES (
    v_run.package_id, v_run.curriculum_id, v_run.id, 'qa_feedback',
    COALESCE(v_run.issue_codes, '{}'), v_heal_action, 'pending', v_run.notes
  ) RETURNING id INTO v_queue_id;

  RETURN v_queue_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_auto_heal_for_test_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_auto_heal_for_test_run(uuid) TO authenticated, service_role;

-- Update record_admin_course_test_run to auto-enqueue heal on issue_found
CREATE OR REPLACE FUNCTION public.record_admin_course_test_run(
  p_package_id uuid, p_curriculum_id uuid, p_test_status text,
  p_notes text DEFAULT NULL, p_issue_codes text[] DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user_id AND ur.role = 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  INSERT INTO public.admin_course_test_runs (
    package_id, curriculum_id, tested_by, test_status, notes, issue_codes
  ) VALUES (
    p_package_id, p_curriculum_id, v_user_id, p_test_status, p_notes, COALESCE(p_issue_codes, '{}')
  ) RETURNING id INTO v_id;

  IF p_test_status = 'issue_found' THEN
    PERFORM public.enqueue_auto_heal_for_test_run(v_id);
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_admin_course_test_run(uuid, uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_admin_course_test_run(uuid, uuid, text, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_auto_heal_queue(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, package_id uuid, curriculum_id uuid, source_test_run_id uuid,
  source text, reason_codes text[], heal_action text, status text,
  notes text, created_at timestamptz, updated_at timestamptz, processed_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT q.id, q.package_id, q.curriculum_id, q.source_test_run_id,
    q.source, q.reason_codes, q.heal_action, q.status,
    q.notes, q.created_at, q.updated_at, q.processed_at
  FROM public.admin_course_auto_heal_queue q
  WHERE p_status IS NULL OR q.status = p_status
  ORDER BY q.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_auto_heal_queue(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_auto_heal_queue(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_admin_auto_heal_status(
  p_queue_id uuid, p_status text, p_notes text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_user_id AND ur.role = 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  UPDATE public.admin_course_auto_heal_queue
  SET status = p_status, notes = COALESCE(p_notes, notes)
  WHERE id = p_queue_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_admin_auto_heal_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_admin_auto_heal_status(uuid, text, text) TO authenticated, service_role;

COMMIT;
