CREATE OR REPLACE FUNCTION public.fn_prebuild_auto_seed_exam_blueprints(p_package_id uuid)
RETURNS TABLE(step_status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_curriculum_id uuid; v_curriculum_title text;
  v_approved_count int; v_total_count int; v_existing_exam_bp int;
  v_now timestamptz := now(); v_step_status text;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id=p_package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text,false,'NO_CURRICULUM'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT ps.status::text INTO v_step_status FROM package_steps ps
   WHERE ps.package_id=p_package_id AND ps.step_key='auto_seed_exam_blueprints';
  IF v_step_status IS NULL OR v_step_status='done' THEN
    RETURN QUERY SELECT 'noop'::text,false,'ALREADY_DONE_OR_MISSING'::text,'{}'::jsonb; RETURN;
  END IF;

  SELECT COUNT(*) FILTER (WHERE qb.status::text='approved'), COUNT(*)
   INTO v_approved_count, v_total_count
   FROM question_blueprints qb WHERE qb.curriculum_id=v_curriculum_id;
  IF v_approved_count < 10 THEN
    RETURN QUERY SELECT 'blocked'::text,false,'INSUFFICIENT_BLUEPRINTS'::text,
      jsonb_build_object('approved',v_approved_count,'total',v_total_count,'required',10); RETURN;
  END IF;

  SELECT COUNT(*) INTO v_existing_exam_bp
   FROM exam_blueprints eb WHERE eb.curriculum_id=v_curriculum_id;

  IF v_existing_exam_bp = 0 THEN
    SELECT COALESCE(c.title,'Prüfungssimulation') INTO v_curriculum_title
     FROM curricula c WHERE c.id=v_curriculum_id;

    INSERT INTO exam_blueprints (
      curriculum_id, title, description, total_questions, time_limit_minutes,
      pass_threshold, difficulty_distribution, question_types, frozen
    ) VALUES (
      v_curriculum_id,
      COALESCE(v_curriculum_title,'Prüfungssimulation') || ' – Standard-Prüfung',
      'Auto-materialisiert aus ' || v_approved_count || ' approved blueprints.',
      LEAST(GREATEST(v_approved_count,30),60), 90, 0.50,
      '{"easy":0.30,"medium":0.50,"hard":0.20}'::jsonb,
      '["single_choice","multiple_choice"]'::jsonb, false
    );
    v_existing_exam_bp := 1;
  END IF;

  UPDATE package_steps ps SET
    status='done', started_at=COALESCE(ps.started_at,v_now),
    finished_at=v_now, updated_at=v_now,
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'ok',true,'executed',true,'prebuild',true,
      'prebuild_fn','fn_prebuild_auto_seed_exam_blueprints',
      'adopted',true,'adopted_from_ssot',true,'postcondition_verified',true,
      'approved_blueprints',v_approved_count,'total_blueprints',v_total_count,
      'exam_blueprints_count',v_existing_exam_bp,'checked_at',v_now::text)
  WHERE ps.package_id=p_package_id AND ps.step_key='auto_seed_exam_blueprints'
    AND ps.status::text!='done';

  RETURN QUERY SELECT 'done'::text,true,'ARTIFACT_TRUTH_MATERIALIZED'::text,
    jsonb_build_object('adopted',true,'approved_blueprints',v_approved_count,
                       'exam_blueprints',v_existing_exam_bp);
END;
$$;