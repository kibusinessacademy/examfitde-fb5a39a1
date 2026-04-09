
-- Fix council_approved drift for AEVO and Betriebswirt packages
UPDATE public.course_packages
SET council_approved = true, updated_at = now()
WHERE id IN ('b960658d-95e9-4824-a404-821d5e9b5142', 'ccdcb409-b708-460c-834d-254a382f8b28')
AND integrity_passed = true;

-- Fix ghost step: set started_at so the finalization guard doesn't block
UPDATE public.package_steps
SET started_at = now(), attempts = 1, updated_at = now()
WHERE package_id IN ('b960658d-95e9-4824-a404-821d5e9b5142', 'ccdcb409-b708-460c-834d-254a382f8b28')
AND step_key = 'auto_publish'
AND started_at IS NULL;
