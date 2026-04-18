-- Upstream Auto-Skip für nicht-applicable package_steps

-- 1) SSOT-Helper
CREATE OR REPLACE FUNCTION public.fn_is_step_applicable_for_package(
  p_package_id uuid,
  p_step_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT tsa.should_run
      FROM public.course_packages cp
      JOIN public.track_step_applicability tsa
        ON tsa.track::text = cp.track::text
       AND tsa.step_key = p_step_key
      WHERE cp.id = p_package_id
      LIMIT 1
    ),
    true
  )
$$;

-- 2) BEFORE-Trigger
CREATE OR REPLACE FUNCTION public.fn_auto_skip_not_applicable_package_step()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_applicable boolean;
  v_track text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'queued' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status::text, '') = 'queued' THEN
    RETURN NEW;
  END IF;

  v_applicable := public.fn_is_step_applicable_for_package(NEW.package_id, NEW.step_key);

  IF NOT COALESCE(v_applicable, true) THEN
    SELECT track::text INTO v_track FROM public.course_packages WHERE id = NEW.package_id;

    NEW.status := 'skipped';
    NEW.started_at := NULL;
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.last_error := NULL;

    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb)
      || jsonb_build_object(
           'skip_reason', 'auto_skipped_not_applicable',
           'skip_source', 'trg_auto_skip_not_applicable_package_step',
           'track', v_track,
           'original_requested_status', 'queued',
           'skipped_at', now()
         );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_skip_not_applicable_package_step ON public.package_steps;

CREATE TRIGGER trg_auto_skip_not_applicable_package_step
BEFORE INSERT OR UPDATE OF status
ON public.package_steps
FOR EACH ROW
EXECUTE FUNCTION public.fn_auto_skip_not_applicable_package_step();

-- 3) Backfill
WITH targets AS (
  SELECT ps.package_id, ps.step_key, cp.track::text AS track
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  JOIN public.track_step_applicability tsa
    ON tsa.track::text = cp.track::text
   AND tsa.step_key = ps.step_key
  WHERE ps.status::text = 'queued'
    AND tsa.should_run = false
)
UPDATE public.package_steps ps
SET status = 'skipped',
    finished_at = COALESCE(ps.finished_at, now()),
    started_at = NULL,
    last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb)
      || jsonb_build_object(
           'skip_reason', 'auto_skipped_not_applicable',
           'skip_source', 'migration_backfill_not_applicable_steps',
           'track', t.track,
           'original_requested_status', 'queued',
           'skipped_at', now()
         ),
    updated_at = now()
FROM targets t
WHERE ps.package_id = t.package_id
  AND ps.step_key = t.step_key;