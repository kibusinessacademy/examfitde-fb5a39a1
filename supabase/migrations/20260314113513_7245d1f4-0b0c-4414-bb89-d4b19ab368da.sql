
CREATE OR REPLACE FUNCTION trg_guard_canonical_density_on_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_density int;
  v_max int;
  v_track text;
BEGIN
  IF NEW.status != 'approved' OR (OLD IS NOT NULL AND OLD.status = 'approved') THEN
    RETURN NEW;
  END IF;
  IF NEW.canonical_hash IS NULL OR NEW.blueprint_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- exam_questions has no package_id; resolve track via curriculum_id → course_packages
  SELECT COALESCE(cp.track, 'AUSBILDUNG_VOLL') INTO v_track
  FROM public.course_packages cp
  WHERE cp.curriculum_id = NEW.curriculum_id
  ORDER BY cp.created_at DESC
  LIMIT 1;

  v_track := COALESCE(v_track, 'AUSBILDUNG_VOLL');

  v_max := CASE
    WHEN v_track = 'EXAM_FIRST' THEN 6
    WHEN v_track = 'ELITE' THEN 12
    ELSE 8
  END;

  SELECT COUNT(*) INTO v_density
  FROM public.exam_questions
  WHERE blueprint_id = NEW.blueprint_id AND canonical_hash = NEW.canonical_hash
    AND status = 'approved' AND id != NEW.id;

  IF v_density >= v_max THEN
    RAISE EXCEPTION 'CANONICAL_DENSITY_EXCEEDED: blueprint=% density=%/% hash=%',
      NEW.blueprint_id, v_density + 1, v_max, LEFT(NEW.canonical_hash, 12)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
