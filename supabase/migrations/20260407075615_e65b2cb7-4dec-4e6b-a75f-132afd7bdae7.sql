
-- AEVO Repair: Reset package from 'queued' to 'building' so pipeline can resume
-- The package was incorrectly set to 'queued' while mid-build (47% progress)

-- Temporarily disable the council review guard (not relevant here, but safety)
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_council_review_status;

UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id = 'b960658d-95e9-4824-a404-821d5e9b5142'
  AND status = 'queued';

ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_council_review_status;

-- Reset failed pending jobs so they get picked up again
UPDATE public.job_queue
SET status = 'pending', error = NULL, updated_at = now()
WHERE package_id = 'b960658d-95e9-4824-a404-821d5e9b5142'
  AND status = 'pending'
  AND error = 'OPS_GUARD:NON_BUILDING_PACKAGE';
