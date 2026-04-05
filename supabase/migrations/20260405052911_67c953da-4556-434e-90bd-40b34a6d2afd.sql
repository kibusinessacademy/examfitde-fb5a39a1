
-- Fix feature_flags for all FORTBILDUNG/ZERTIFIKAT packages
-- These are full-product tracks that should have learning course, handbook, minichecks
UPDATE course_packages
SET feature_flags = feature_flags 
  || '{"has_learning_course":true,"has_handbook":true,"has_minichecks":true,"has_practice_course_h5p":true,"ai_tutor_mode":"full"}'::jsonb
WHERE track IN ('FORTBILDUNG', 'ZERTIFIKAT')
  AND (feature_flags->>'has_learning_course')::text = 'false';

-- Audit
INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail) VALUES
  ('admin_ops', 'fix_feature_flags', 'FORTBILDUNG_ZERTIFIKAT_BATCH', 'track', 'success', 
   '{"reason":"FORTBILDUNG/ZERTIFIKAT tracks normalize to AUSBILDUNG_VOLL but had EXAM_FIRST flags","affected_count":10}');
