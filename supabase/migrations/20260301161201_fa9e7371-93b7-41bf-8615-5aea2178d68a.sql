-- Add 'archived' to allowed course_packages status values
ALTER TABLE public.course_packages DROP CONSTRAINT course_packages_status_check;

ALTER TABLE public.course_packages ADD CONSTRAINT course_packages_status_check 
  CHECK (status = ANY (ARRAY[
    'planning'::text, 
    'council_review'::text, 
    'queued'::text, 
    'building'::text, 
    'qa'::text, 
    'published'::text, 
    'failed'::text, 
    'blocked'::text, 
    'done'::text, 
    'quality_gate_failed'::text,
    'archived'::text
  ]));

-- Update the immutable guard to allow archiving published packages
CREATE OR REPLACE FUNCTION public.guard_published_package_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  -- Allow status change TO 'archived' (retirement of old packages)
  IF NEW.status = 'archived' AND OLD.status IN ('published', 'quality_gate_failed', 'done', 'council_review') THEN
    RETURN NEW;
  END IF;

  -- Allow cosmetic metadata maintenance on published packages
  IF OLD.published_at IS NOT NULL AND OLD.status = 'published' THEN
    -- Block content-altering changes
    IF NEW.status IS DISTINCT FROM OLD.status 
       AND NEW.status != 'archived' THEN
      RAISE EXCEPTION 'IMMUTABLE_PACKAGE: Cannot change status of published package %', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;