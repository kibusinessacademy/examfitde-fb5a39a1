
-- Guard: prevent direct manipulation of published_versions without approved council verdict
CREATE OR REPLACE FUNCTION public.guard_publish_requires_council_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_key text;
  v_version_id uuid;
  v_status text;
BEGIN
  -- Only check if published_versions changed
  IF NEW.published_versions IS NOT DISTINCT FROM OLD.published_versions THEN
    RETURN NEW;
  END IF;

  -- Check each new step entry has an approved content_version
  FOR v_step_key, v_version_id IN
    SELECT key, (value #>> '{}')::uuid
    FROM jsonb_each(NEW.published_versions)
    WHERE NOT OLD.published_versions ? key
       OR OLD.published_versions ->> key IS DISTINCT FROM NEW.published_versions ->> key
  LOOP
    SELECT cv.status INTO v_status
    FROM content_versions cv
    WHERE cv.id = v_version_id;

    IF v_status IS NULL THEN
      RAISE EXCEPTION 'PUBLISH_GUARD: version % for step % does not exist', v_version_id, v_step_key;
    END IF;

    IF v_status != 'approved' THEN
      RAISE EXCEPTION 'PUBLISH_GUARD: version % for step % has status=% (must be approved)', v_version_id, v_step_key, v_status;
    END IF;

    -- Verify council verdict exists and is approved
    IF NOT EXISTS (
      SELECT 1 FROM council_verdicts
      WHERE content_version_id = v_version_id
        AND final_decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'PUBLISH_GUARD: version % for step % has no approved council verdict', v_version_id, v_step_key;
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_guard_publish_council ON public.lessons;
CREATE TRIGGER trg_guard_publish_council
  BEFORE UPDATE OF published_versions ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_publish_requires_council_approval();
