
CREATE OR REPLACE FUNCTION public.trg_set_oral_trainer_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_title_lower text;
BEGIN
  -- Try certification-based resolution first
  IF NEW.certification_id IS NOT NULL THEN
    SELECT fn_resolve_oral_trainer_mode(NEW.certification_id) INTO v_mode;
  END IF;
  
  -- Title-based fallback for packages without certification_id
  IF v_mode IS NULL AND NEW.title IS NOT NULL THEN
    v_title_lower := lower(NEW.title);
    IF v_title_lower LIKE '%meister%'
       OR v_title_lower LIKE '%aevo%'
       OR v_title_lower LIKE '%ausbilder%'
       OR v_title_lower LIKE '%fachwirt%'
       OR v_title_lower LIKE '%betriebswirt%'
    THEN
      v_mode := 'official_simulation';
    END IF;
  END IF;
  
  v_mode := COALESCE(v_mode, 'didactic_viva');
  
  -- Skip if already set correctly (prevent infinite trigger loop)
  IF NEW.feature_flags IS NOT NULL 
     AND NEW.feature_flags->>'oral_trainer_mode' = v_mode 
     AND NEW.feature_flags->>'oral_trainer_enabled' = 'true'
  THEN
    RETURN NEW;
  END IF;
  
  NEW.feature_flags := COALESCE(NEW.feature_flags, '{}'::jsonb) 
    || jsonb_build_object(
      'oral_trainer_enabled', true,
      'oral_trainer_mode', v_mode
    );
  
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger to fire on title changes too
DROP TRIGGER IF EXISTS trg_auto_oral_trainer_mode ON course_packages;
CREATE TRIGGER trg_auto_oral_trainer_mode
  BEFORE INSERT OR UPDATE OF certification_id, feature_flags, title
  ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_oral_trainer_mode();
