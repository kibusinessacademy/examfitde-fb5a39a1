
-- Drop existing function with conflicting return type
DROP FUNCTION IF EXISTS public.update_course_package_step(uuid, text, text, jsonb);

-- 1) get_course_package_build_state
CREATE OR REPLACE FUNCTION public.get_course_package_build_state(
  p_package_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg jsonb;
  v_steps jsonb;
  v_plan jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT to_jsonb(cp.*) INTO v_pkg
  FROM public.course_packages cp
  WHERE cp.id = p_package_id;

  IF v_pkg IS NULL THEN
    RETURN jsonb_build_object('error', 'package_not_found');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order), '[]'::jsonb) INTO v_steps
  FROM public.course_package_build_steps s
  WHERE s.package_id = p_package_id;

  SELECT to_jsonb(p.*) INTO v_plan
  FROM public.course_package_plans p
  WHERE p.package_id = p_package_id
    AND p.status = 'approved'
  ORDER BY p.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'package', v_pkg,
    'steps', v_steps,
    'approved_plan', coalesce(v_plan, '{}'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_course_package_build_state(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_course_package_build_state(uuid) TO authenticated;

-- 2) get_course_package_export_link
CREATE OR REPLACE FUNCTION public.get_course_package_export_link(
  p_package_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT payload INTO v_out
  FROM public.course_package_outputs
  WHERE package_id = p_package_id
    AND output_key = 'export_zip'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN coalesce(v_out, '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.get_course_package_export_link(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_course_package_export_link(uuid) TO authenticated;

-- 3) update_course_package_step (re-create with RETURNS void)
CREATE OR REPLACE FUNCTION public.update_course_package_step(
  p_package_id uuid,
  p_step_key text,
  p_status text,
  p_log jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_label text;
  v_sort int;
BEGIN
  SELECT 
    CASE p_step_key
      WHEN 'scaffold_learning_course' THEN 'Lernkurs Scaffold'
      WHEN 'generate_minichecks' THEN 'MiniChecks generieren'
      WHEN 'generate_exam_pool' THEN 'Prüfungsfragen-Pool (1000+)'
      WHEN 'build_exam_simulation' THEN 'Simulation Presets'
      WHEN 'generate_oral_exam' THEN 'Mündliche Prüfung'
      WHEN 'build_ai_tutor_index' THEN 'AI Tutor Index'
      WHEN 'generate_handbook' THEN 'Handbuch'
      WHEN 'run_integrity_check' THEN 'Integritätsprüfung'
      WHEN 'auto_publish' THEN 'Auto-Publish'
      ELSE p_step_key
    END,
    CASE p_step_key
      WHEN 'scaffold_learning_course' THEN 1
      WHEN 'generate_minichecks' THEN 2
      WHEN 'generate_exam_pool' THEN 3
      WHEN 'build_exam_simulation' THEN 4
      WHEN 'generate_oral_exam' THEN 5
      WHEN 'build_ai_tutor_index' THEN 6
      WHEN 'generate_handbook' THEN 7
      WHEN 'run_integrity_check' THEN 8
      WHEN 'auto_publish' THEN 9
      ELSE 99
    END
  INTO v_step_label, v_sort;

  INSERT INTO public.course_package_build_steps (package_id, step_key, step_label, sort_order, status, log, started_at)
  VALUES (p_package_id, p_step_key, v_step_label, v_sort, p_status, p_log, 
    CASE WHEN p_status = 'running' THEN now() ELSE NULL END)
  ON CONFLICT (package_id, step_key) DO UPDATE SET
    status = EXCLUDED.status,
    log = COALESCE(EXCLUDED.log, course_package_build_steps.log),
    started_at = CASE WHEN EXCLUDED.status = 'running' THEN now() ELSE course_package_build_steps.started_at END,
    finished_at = CASE WHEN EXCLUDED.status IN ('done', 'failed') THEN now() ELSE NULL END,
    duration_ms = CASE WHEN EXCLUDED.status IN ('done', 'failed') AND course_package_build_steps.started_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (now() - course_package_build_steps.started_at)) * 1000
      ELSE NULL END;
END $$;

-- Unique constraint for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_build_steps_package_step'
  ) THEN
    ALTER TABLE public.course_package_build_steps
      ADD CONSTRAINT uq_build_steps_package_step UNIQUE (package_id, step_key);
  END IF;
END $$;
