DO $$
DECLARE
  v_pkg_a uuid := '091fb5ed-3bea-5e0b-840e-e07845a5ebc5';
  v_pkg_b uuid := '18f12a68-10f3-5e61-aa49-ecf48728652b';
  v_promoted_a int; v_promoted_b int; v_steps_a int;
BEGIN
  WITH upd AS (
    UPDATE public.exam_questions
       SET status='approved'::question_status, qc_status='approved',
           reviewed_at = COALESCE(reviewed_at, now())
     WHERE package_id = v_pkg_a AND status='draft'
       AND correct_answer IS NOT NULL AND cognitive_level IS NOT NULL
       AND competency_id IS NOT NULL AND curriculum_id IS NOT NULL
       AND difficulty IS NOT NULL AND learning_field_id IS NOT NULL
       AND question_text IS NOT NULL AND length(question_text) > 10
     RETURNING 1
  ) SELECT count(*) INTO v_promoted_a FROM upd;

  WITH upd AS (
    UPDATE public.exam_questions
       SET status='approved'::question_status, qc_status='approved',
           reviewed_at = COALESCE(reviewed_at, now())
     WHERE package_id = v_pkg_b AND status='draft'
       AND correct_answer IS NOT NULL AND cognitive_level IS NOT NULL
       AND competency_id IS NOT NULL AND curriculum_id IS NOT NULL
       AND difficulty IS NOT NULL AND learning_field_id IS NOT NULL
       AND question_text IS NOT NULL AND length(question_text) > 10
     RETURNING 1
  ) SELECT count(*) INTO v_promoted_b FROM upd;

  WITH upd AS (
    UPDATE public.package_steps SET status='queued'::step_status, updated_at=now()
     WHERE package_id=v_pkg_a AND step_key='auto_publish' AND status='blocked'
     RETURNING 1
  ) SELECT count(*) INTO v_steps_a FROM upd;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata) VALUES
    ('manual_bypass_hidden_drafts_promote','package',v_pkg_a,'success',
      jsonb_build_object('package_id',v_pkg_a,'drafts_promoted',v_promoted_a,'auto_publish_unblocked',v_steps_a,'pattern','HIDDEN_DRAFTS')),
    ('manual_bypass_hidden_drafts_promote','package',v_pkg_b,'success',
      jsonb_build_object('package_id',v_pkg_b,'drafts_promoted',v_promoted_b,'pattern','HIDDEN_DRAFTS'));

  RAISE NOTICE 'pkg_a promoted=% steps_unblocked=% | pkg_b promoted=%', v_promoted_a, v_steps_a, v_promoted_b;
END$$;