-- 1) Remove the universal recovery shield trigger (it caused a deadlock)
DROP TRIGGER IF EXISTS trg_00_recovery_grace_shield ON public.course_packages;
DROP FUNCTION IF EXISTS public.guard_recovery_grace_period();

-- 2) Reset all 10 Wave 1 packages back to queued so the runner can
--    acquire them naturally within WIP limits (5 at a time)
UPDATE public.course_packages
SET status = 'queued', updated_at = now()
WHERE id IN (
  '188daeb5-205e-4fb4-aadc-de59029406f5',
  '398573ab-bc9d-4fc9-9d8e-3607c24f3bf9',
  '575a917a-bd7c-48df-afc0-bda29389c40f',
  '5d23ff92-0f91-4f19-a01b-3b7f8edc38ff',
  '6337d885-bd02-4d4f-aaa5-fb118d643cd8',
  '92d333cf-bbd3-4292-b85b-ba933c7c4ae1',
  'ae384df2-2ce2-4842-8074-3c9f0ebbb414',
  'c636b6bc-fcae-4d8f-b8ca-87647d9fee6c',
  'e90a5e24-5a51-4afa-aeae-0b97407eadee',
  'ebbc4dcb-ff3a-43fb-b9d1-dad8d1e22de3'
)
AND status = 'building';

-- 3) Ensure package_steps are in queued state (not stale running/enqueued)
UPDATE public.package_steps
SET status = 'queued', updated_at = now()
WHERE package_id IN (
  '188daeb5-205e-4fb4-aadc-de59029406f5',
  '398573ab-bc9d-4fc9-9d8e-3607c24f3bf9',
  '575a917a-bd7c-48df-afc0-bda29389c40f',
  '5d23ff92-0f91-4f19-a01b-3b7f8edc38ff',
  '6337d885-bd02-4d4f-aaa5-fb118d643cd8',
  '92d333cf-bbd3-4292-b85b-ba933c7c4ae1',
  'ae384df2-2ce2-4842-8074-3c9f0ebbb414',
  'c636b6bc-fcae-4d8f-b8ca-87647d9fee6c',
  'e90a5e24-5a51-4afa-aeae-0b97407eadee',
  'ebbc4dcb-ff3a-43fb-b9d1-dad8d1e22de3'
)
AND status IN ('running', 'enqueued');