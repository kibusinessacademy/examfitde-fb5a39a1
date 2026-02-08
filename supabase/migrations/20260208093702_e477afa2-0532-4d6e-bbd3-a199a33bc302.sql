-- Security Fixes für Blueprint-Template-System
-- ============================================================

-- 1. View mit SECURITY INVOKER statt DEFINER (Standard-Verhalten)
DROP VIEW IF EXISTS public.blueprint_questions_view;

CREATE VIEW public.blueprint_questions_view 
WITH (security_invoker = true) AS
SELECT 
  qb.id AS blueprint_id,
  qb.name AS blueprint_name,
  qb.question_template,
  qb.knowledge_type,
  qb.cognitive_level,
  qb.exam_relevance,
  qb.status,
  qb.version,
  c.title AS curriculum_title,
  lf.title AS learning_field_title,
  lf.code AS learning_field_code,
  comp.title AS competency_title,
  comp.code AS competency_code,
  (SELECT COUNT(*) FROM public.blueprint_variants bv WHERE bv.blueprint_id = qb.id) AS variant_count,
  (SELECT COUNT(*) FROM public.blueprint_variables bvar WHERE bvar.blueprint_id = qb.id) AS variable_count
FROM public.question_blueprints qb
LEFT JOIN public.curricula c ON qb.curriculum_id = c.id
LEFT JOIN public.learning_fields lf ON qb.learning_field_id = lf.id
LEFT JOIN public.competencies comp ON qb.competency_id = comp.id;

-- 2. Funktion mit search_path fixen
DROP FUNCTION IF EXISTS public.validate_blueprint_constraints(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.validate_blueprint_constraints(
  p_blueprint_id UUID,
  p_variable_values JSONB
) RETURNS TABLE (
  is_valid BOOLEAN,
  errors TEXT[]
) LANGUAGE plpgsql SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_errors TEXT[] := ARRAY[]::TEXT[];
  v_constraint RECORD;
  v_condition_key TEXT;
  v_condition_value TEXT;
  v_actual_value TEXT;
BEGIN
  -- Prüfe alle aktiven Constraints
  FOR v_constraint IN 
    SELECT * FROM public.blueprint_constraints 
    WHERE blueprint_id = p_blueprint_id AND is_active = true
    ORDER BY priority DESC
  LOOP
    -- Constraint-Typ: forbidden
    IF v_constraint.constraint_type = 'forbidden' THEN
      -- Prüfe ob verbotene Kombination vorliegt
      IF p_variable_values @> v_constraint.condition_expression THEN
        v_errors := array_append(v_errors, 
          'Verbotene Kombination: ' || v_constraint.description);
      END IF;
    
    -- Constraint-Typ: required
    ELSIF v_constraint.constraint_type = 'required' THEN
      -- Prüfe ob Pflichtfelder vorhanden
      FOR v_condition_key IN SELECT jsonb_object_keys(v_constraint.condition_expression)
      LOOP
        IF NOT p_variable_values ? v_condition_key THEN
          v_errors := array_append(v_errors, 
            'Pflichtfeld fehlt: ' || v_condition_key);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT array_length(v_errors, 1) IS NULL OR array_length(v_errors, 1) = 0, v_errors;
END;
$$;