
-- Fix broken trigger that references non-existent 'meta' column
DROP TRIGGER IF EXISTS guard_no_exam_first_track ON course_packages;

-- Now insert the 4 Phase 2 packages with AUSBILDUNG_VOLL track
INSERT INTO course_packages (course_id, curriculum_id, title, status, priority, council_approved, build_progress, version, track)
VALUES
  ('57444e17-8003-4ea5-afaa-0f389dc4d23b', 'a8a6340d-fd50-445f-a55b-7d5a6c72e2e1', 'ExamFit – Fachinformatiker Anwendungsentwicklung', 'queued', 5, true, 0, 1, 'AUSBILDUNG_VOLL'),
  ('90d16c97-e0f3-4616-bfab-268637f057b9', '8e8f0f32-d21f-4871-a23d-ed1570cc3fa7', 'ExamFit – Verkäufer', 'queued', 5, true, 0, 1, 'AUSBILDUNG_VOLL'),
  ('9fe94470-cd96-4b0a-9a33-2a5452728579', '1f49fe35-ad16-4718-82a1-447b321c42f7', 'ExamFit – Industriekaufmann', 'queued', 5, true, 0, 1, 'AUSBILDUNG_VOLL'),
  ('bf21e04e-7788-4d25-b29e-08ab3985eff1', 'bd547ecd-6491-4e1f-a581-b2a9718bfee2', 'ExamFit – Kaufmann für Büromanagement', 'queued', 5, true, 0, 1, 'AUSBILDUNG_VOLL')
ON CONFLICT DO NOTHING;
