
-- ============================================================
-- 1. ARCHIVE old PKA v2 package (EXAM_FIRST, hollow)
-- ============================================================
UPDATE public.course_packages 
SET archived = true, updated_at = now()
WHERE id = '01b6c589-4f7e-4ade-b234-a9666f69fd3a';

-- ============================================================
-- 2. CREATE new PKA v3 rebuild package with AUSBILDUNG_VOLL track
--    Same course, same curriculum, full pipeline
--    Priority 2 = high (matches published v1 priority)
-- ============================================================
INSERT INTO public.course_packages (
  id, course_id, curriculum_id, title, status, track, 
  priority, version, build_progress, product_id,
  feature_flags, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'f639a5cf-78ef-4233-8b56-8c612c556ee6',
  '604d730d-e008-468a-b4ef-a9477de06ef4',
  'ExamFit – Pharmazeutisch-kaufmännischer Angestellter/-in',
  'queued',
  'AUSBILDUNG_VOLL',
  2,
  2,
  0,
  NULL,  -- no product_id yet; will swap atomically on publish
  '{"has_exam_trainer": true, "has_exam_simulation": true, "has_learning_course": true, "has_minichecks": true, "has_handbook": true, "has_oral_exam_trainer": true, "has_ai_tutor": true, "ai_tutor_mode": "full", "has_practice_course_h5p": false}'::jsonb,
  now(), now()
);

-- ============================================================
-- 3. UNBLOCK Bürokaufmann: enrichment is 100%, clear stale gate
-- ============================================================
UPDATE public.course_packages 
SET blocked_reason = NULL, 
    last_error = NULL,
    updated_at = now()
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7';

-- Also reset the stuck generate_learning_content step so runner retries
UPDATE public.package_steps 
SET status = 'queued', 
    attempts = 0, 
    last_error = NULL,
    updated_at = now()
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'generate_learning_content'
  AND status = 'queued';

-- Reset generate_exam_pool step too (was waiting on lessons)
UPDATE public.package_steps 
SET last_error = NULL,
    updated_at = now()
WHERE package_id = '5377ab93-fe17-488c-a266-bdb26b672da7'
  AND step_key = 'generate_exam_pool';
