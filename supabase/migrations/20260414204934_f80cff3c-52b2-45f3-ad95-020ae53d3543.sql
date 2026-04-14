
-- 1. Fix track_step_applicability: Oral Exam Steps für EXAM_FIRST_PLUS aktivieren
UPDATE public.track_step_applicability
SET should_run = true
WHERE track = 'EXAM_FIRST_PLUS'
  AND step_key IN ('generate_oral_exam', 'validate_oral_exam');

-- 2. Alle geskippten Oral-Exam-Steps für EXAM_FIRST_PLUS Pakete auf queued setzen
UPDATE public.package_steps ps
SET status = 'queued',
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || '{"unskipped_reason": "oral_exam_enabled_for_exam_first_plus"}'::jsonb
FROM public.course_packages cp
WHERE ps.package_id = cp.id
  AND cp.track = 'EXAM_FIRST_PLUS'
  AND ps.step_key IN ('generate_oral_exam', 'validate_oral_exam')
  AND ps.status = 'skipped';

-- 3. Audit-Log
INSERT INTO public.admin_actions (action, scope, payload)
VALUES (
  'enable_oral_exam_for_exam_first_plus',
  'track_step_applicability',
  '{"reason": "Fachwirte/Betriebswirte/Meister require oral exam trainer", "steps": ["generate_oral_exam", "validate_oral_exam"]}'::jsonb
);
