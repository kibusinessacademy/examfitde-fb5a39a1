-- Fix 1: Clear blocked_reason on our 10 Wave 1 packages so they can be acquired
UPDATE public.course_packages
SET blocked_reason = NULL, updated_at = now()
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
AND status = 'queued';

-- Fix 2: The 5 prio-1 packages are permanently blocked (loop_guard, kill_switch)
-- They should be status='blocked' not 'queued', so they stop poisoning
-- the min_incomplete_priority calculation
UPDATE public.course_packages
SET status = 'blocked', updated_at = now()
WHERE status = 'queued'
  AND priority = 1
  AND blocked_reason IS NOT NULL
  AND blocked_reason != '';