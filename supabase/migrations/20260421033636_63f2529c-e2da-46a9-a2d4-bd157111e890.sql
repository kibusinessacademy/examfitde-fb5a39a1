
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
  v_curriculum_id uuid;
BEGIN
  IF NEW.status='done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    IF NEW.step_key='auto_seed_exam_blueprints' THEN
      SELECT cp.curriculum_id INTO v_curriculum_id
        FROM public.course_packages cp WHERE cp.id=NEW.package_id;
      -- FIX: Producer-SSOT ist question_blueprints (nicht exam_blueprints).
      -- Aktive Rows: deprecated_at IS NULL UND status <> 'deprecated'.
      SELECT COUNT(*) INTO v_blueprint_count
        FROM public.question_blueprints
        WHERE curriculum_id = v_curriculum_id
          AND deprecated_at IS NULL
          AND status::text <> 'deprecated';
      IF COALESCE(v_blueprint_count,0)=0 THEN
        RAISE EXCEPTION
          'NON_BYPASSABLE_HOLLOW_DONE: auto_seed_exam_blueprints cannot be done with 0 active question_blueprints (package_id=%, curriculum_id=%). No bypass allowed.',
          NEW.package_id, v_curriculum_id
        USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END IF;
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
