
INSERT INTO curricula (id, title, certification_type, track) VALUES
  ('d1000000-0007-4000-8000-000000000001', 'Pflegefachmann/-frau', 'ausbildung', 'EXAM_FIRST'),
  ('d1000000-0008-4000-8000-000000000001', 'Pflegefachassistent/-in', 'ausbildung', 'EXAM_FIRST')
ON CONFLICT (id) DO NOTHING;

INSERT INTO course_packages (id, curriculum_id, title, priority, status, track, build_progress) VALUES
  ('d2000000-0007-4000-8000-000000000001', 'd1000000-0007-4000-8000-000000000001', 'Pflegefachmann/-frau', 2, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0008-4000-8000-000000000001', 'd1000000-0008-4000-8000-000000000001', 'Pflegefachassistent/-in', 3, 'queued', 'EXAM_FIRST', 0)
ON CONFLICT (id) DO NOTHING;
