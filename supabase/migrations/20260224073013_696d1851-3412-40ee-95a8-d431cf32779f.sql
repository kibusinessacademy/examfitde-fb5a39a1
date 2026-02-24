
CREATE OR REPLACE FUNCTION approve_blueprints_from_council(p_blueprint_ids uuid[], p_approved_by text DEFAULT 'quality_council')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE question_blueprints
  SET 
    status = 'approved',
    approved_at = now(),
    approved_by = p_approved_by,
    approved_version_id = gen_random_uuid()::text,
    updated_at = now()
  WHERE id = ANY(p_blueprint_ids)
    AND status IN ('draft', 'review')
    AND question_template IS NOT NULL 
    AND question_template != ''
    AND typical_exam_trap IS NOT NULL;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
