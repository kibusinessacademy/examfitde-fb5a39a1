
-- Function to resolve oral trainer mode from certification catalog
CREATE OR REPLACE FUNCTION public.fn_resolve_oral_trainer_mode(p_certification_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE 
    WHEN cc.oral_component = true THEN 'official_simulation'
    ELSE 'didactic_viva'
  END
  FROM certification_catalog cc
  WHERE cc.id = p_certification_id
$$;

-- Trigger function to auto-set oral_trainer_mode in feature_flags
CREATE OR REPLACE FUNCTION public.trg_set_oral_trainer_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  -- Resolve mode from certification
  SELECT fn_resolve_oral_trainer_mode(NEW.certification_id) INTO v_mode;
  
  -- Default to didactic_viva if no certification found
  v_mode := COALESCE(v_mode, 'didactic_viva');
  
  -- Merge into feature_flags (preserve existing flags)
  NEW.feature_flags := COALESCE(NEW.feature_flags, '{}'::jsonb) 
    || jsonb_build_object(
      'oral_trainer_enabled', true,
      'oral_trainer_mode', v_mode
    );
  
  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_auto_oral_trainer_mode ON course_packages;
CREATE TRIGGER trg_auto_oral_trainer_mode
  BEFORE INSERT OR UPDATE OF certification_id, feature_flags
  ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_oral_trainer_mode();

-- Backfill all existing non-archived packages
UPDATE course_packages cp
SET feature_flags = COALESCE(cp.feature_flags, '{}'::jsonb) 
  || jsonb_build_object(
    'oral_trainer_enabled', true,
    'oral_trainer_mode', COALESCE(fn_resolve_oral_trainer_mode(cp.certification_id), 'didactic_viva')
  )
WHERE cp.status != 'archived';
