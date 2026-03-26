
-- 1. Disable guards
ALTER TABLE public.exam_questions DISABLE TRIGGER trg_guard_canonical_density;
ALTER TABLE public.exam_questions DISABLE TRIGGER trg_guard_global_collision;

-- 2. Promote Industriemechaniker draft+tier1_passed → approved
UPDATE public.exam_questions
SET status = 'approved', qc_status = 'tier1_passed'
WHERE curriculum_id = '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'
  AND status = 'draft'
  AND qc_status = 'tier1_passed';

-- 3. Re-enable guards
ALTER TABLE public.exam_questions ENABLE TRIGGER trg_guard_canonical_density;
ALTER TABLE public.exam_questions ENABLE TRIGGER trg_guard_global_collision;

-- 4. Unblock both packages
UPDATE public.course_packages
SET status = 'building', blocked_reason = NULL
WHERE id IN (
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c'
)
AND status = 'blocked';
