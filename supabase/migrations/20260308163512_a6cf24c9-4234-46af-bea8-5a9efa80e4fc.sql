CREATE OR REPLACE FUNCTION public.seed_blueprint_targets_for_curriculum(p_curriculum_id uuid, p_track text DEFAULT NULL::text, p_mode text DEFAULT 'default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_track text;
  v_recall int;
  v_app int;
  v_scenario int;
  v_transfer int;
  v_error int;
  v_upserts int := 0;
BEGIN
  -- detect track from latest package if not given
  IF p_track IS NOT NULL THEN
    v_track := p_track;
  ELSE
    SELECT cp.track::text INTO v_track
    FROM public.course_packages cp
    WHERE cp.curriculum_id = p_curriculum_id
    ORDER BY cp.created_at DESC LIMIT 1;
    IF v_track IS NULL THEN v_track := 'AUSBILDUNG_VOLL'; END IF;
  END IF;

  IF v_track = 'EXAM_FIRST' THEN
    v_recall := 1; v_app := 1; v_scenario := 2; v_transfer := 0; v_error := 1;
    IF p_mode = 'heavy' THEN v_transfer := 1; END IF;
  ELSIF v_track = 'ELITE' THEN
    v_recall := 2; v_app := 3; v_scenario := 4; v_transfer := 2; v_error := 3;
    IF p_mode = 'light' THEN v_transfer := 1; v_error := 2; END IF;
  ELSE
    v_recall := 2; v_app := 2; v_scenario := 3; v_transfer := 1; v_error := 2;
    IF p_mode = 'light' THEN v_transfer := 0; v_error := 1; END IF;
    IF p_mode = 'heavy' THEN v_scenario := 4; v_error := 3; END IF;
  END IF;

  WITH comps AS (
    SELECT comp.id AS competency_id
    FROM public.learning_fields lf
    JOIN public.competencies comp ON comp.learning_field_id = lf.id
    WHERE lf.curriculum_id = p_curriculum_id
  ),
  up AS (
    INSERT INTO public.blueprint_targets (
      curriculum_id, competency_id,
      target_recall, target_application, target_scenario, target_transfer, target_error_patterns,
      target_total, priority, created_at, updated_at
    )
    SELECT p_curriculum_id, c.competency_id,
      v_recall, v_app, v_scenario, v_transfer, v_error,
      v_recall + v_app + v_scenario + v_transfer + v_error,
      0, now(), now()
    FROM comps c
    ON CONFLICT (curriculum_id, competency_id)
    DO UPDATE SET
      target_recall = EXCLUDED.target_recall,
      target_application = EXCLUDED.target_application,
      target_scenario = EXCLUDED.target_scenario,
      target_transfer = EXCLUDED.target_transfer,
      target_error_patterns = EXCLUDED.target_error_patterns,
      target_total = EXCLUDED.target_total,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserts FROM up;

  RETURN jsonb_build_object(
    'curriculum_id', p_curriculum_id, 'track', v_track, 'mode', p_mode,
    'upserts', v_upserts,
    'targets', jsonb_build_object(
      'recall', v_recall, 'application', v_app, 'scenario', v_scenario,
      'transfer', v_transfer, 'error_patterns', v_error,
      'total_per_comp', v_recall + v_app + v_scenario + v_transfer + v_error
    ), 'ts', now()
  );
END;
$function$;