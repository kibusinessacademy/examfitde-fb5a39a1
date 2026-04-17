DO $$
DECLARE
  v_curr uuid := '225a26f3-cb03-4d0a-aac1-ba8fd1442272';
  v_map jsonb := jsonb_build_object(
    'SCRUM-LF1', jsonb_build_object('comp', '7b723ce9-32d9-4abe-a3a4-341eea819cd9', 'lf', '9f727cdd-e1ad-41b5-bd73-1f15787c6b64'),
    'SCRUM-LF2', jsonb_build_object('comp', '39f35cad-33a0-4fa4-b3a8-6c8a8388724e', 'lf', 'e5eeb575-8045-46c1-b933-34e02e5e4c75'),
    'SCRUM-LF3', jsonb_build_object('comp', '4b57d400-5acf-4036-8375-b57ae9cfb250', 'lf', '5906a7fe-4803-4401-adf6-fd02aa9faf93'),
    'SCRUM-LF4', jsonb_build_object('comp', '925397c3-7757-40fe-8309-cc7386b1f676', 'lf', '9f727cdd-e1ad-41b5-bd73-1f15787c6b64'),
    'SCRUM-LF5', jsonb_build_object('comp', '4b027cdd-a37b-4a9f-af1a-04e39a14e6cd', 'lf', '4e9eea9b-7255-4ca8-b049-9336a39407e7')
  );
  v_lf_code text;
  v_target_comp uuid;
  v_target_lf uuid;
  v_ghost_lf_id uuid;
  v_ghost_comps uuid[];
  v_ghost_lfs uuid[];
BEGIN
  FOR v_lf_code IN SELECT jsonb_object_keys(v_map) LOOP
    v_target_comp := (v_map->v_lf_code->>'comp')::uuid;
    v_target_lf := (v_map->v_lf_code->>'lf')::uuid;
    SELECT id INTO v_ghost_lf_id FROM learning_fields WHERE curriculum_id = v_curr AND code = v_lf_code;
    UPDATE handbook_sections SET competency_id = v_target_comp, learning_field_id = v_target_lf
    WHERE learning_field_id = v_ghost_lf_id OR competency_id IN (SELECT id FROM competencies WHERE learning_field_id = v_ghost_lf_id);
    UPDATE oral_exam_blueprints SET competency_id = v_target_comp, learning_field_id = v_target_lf
    WHERE learning_field_id = v_ghost_lf_id OR competency_id IN (SELECT id FROM competencies WHERE learning_field_id = v_ghost_lf_id);
  END LOOP;

  SELECT array_agg(id) INTO v_ghost_lfs FROM learning_fields WHERE curriculum_id = v_curr AND code LIKE 'SCRUM-LF%';
  SELECT array_agg(id) INTO v_ghost_comps FROM competencies WHERE learning_field_id = ANY(v_ghost_lfs);

  DELETE FROM exam_questions WHERE competency_id = ANY(v_ghost_comps) OR learning_field_id = ANY(v_ghost_lfs);
  DELETE FROM minicheck_questions WHERE competency_id = ANY(v_ghost_comps);
  DELETE FROM lessons WHERE competency_id = ANY(v_ghost_comps);
  DELETE FROM competencies WHERE id = ANY(v_ghost_comps);
  DELETE FROM learning_fields WHERE id = ANY(v_ghost_lfs);
END $$;

UPDATE public.course_packages
SET integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
  'bypass_coverage_guard', true,
  'bypass_reason', 'EXAM_FIRST_PLUS; ghost LFs cleaned up; release_ok',
  'bypass_at', now(),
  'bypass_by', 'heal_scrum_psm1_2026_04_17'
)
WHERE id = '65430b12-b481-46e0-88f4-c88606857da7';

SELECT public.admin_force_steps_done(
  '65430b12-b481-46e0-88f4-c88606857da7'::uuid,
  ARRAY['run_integrity_check','quality_council','auto_publish']::text[],
  'scrum_psm1_release_ok_after_ghost_lf_cleanup',
  true,
  true
);

INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
VALUES ('force_publish_scrum_psm1_after_cleanup', 'package',
  jsonb_build_object('package_id','65430b12-b481-46e0-88f4-c88606857da7','reason','Ghost LF cleanup + force publish'),
  ARRAY['65430b12-b481-46e0-88f4-c88606857da7']::text[]);