
-- Alle 5 Curricula
INSERT INTO curricula (id, title, certification_type, track) VALUES
  ('d1000000-0001-4000-8000-000000000001', 'Verwaltungswirt/-in (mittlerer Dienst)', 'sonstige', 'EXAM_FIRST'),
  ('d1000000-0002-4000-8000-000000000001', 'Verwaltungsfachwirt/-in', 'aufstiegsfortbildung', 'EXAM_FIRST_PLUS'),
  ('d1000000-0003-4000-8000-000000000001', 'Justizfachwirt/-in', 'aufstiegsfortbildung', 'EXAM_FIRST'),
  ('d1000000-0004-4000-8000-000000000001', 'Polizeivollzugsdienst (Theorie)', 'sonstige', 'EXAM_FIRST'),
  ('d1000000-0005-4000-8000-000000000001', 'Zollbeamte mittlerer/gehobener Dienst', 'sonstige', 'EXAM_FIRST')
ON CONFLICT (id) DO NOTHING;

-- Alle 5 Pakete
INSERT INTO course_packages (id, curriculum_id, title, priority, status, track, build_progress) VALUES
  ('d2000000-0001-4000-8000-000000000001', 'd1000000-0001-4000-8000-000000000001', 'Verwaltungswirt/-in (mittlerer Dienst)', 1, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0002-4000-8000-000000000001', 'd1000000-0002-4000-8000-000000000001', 'Verwaltungsfachwirt/-in', 1, 'queued', 'EXAM_FIRST_PLUS', 0),
  ('d2000000-0003-4000-8000-000000000001', 'd1000000-0003-4000-8000-000000000001', 'Justizfachwirt/-in', 2, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0004-4000-8000-000000000001', 'd1000000-0004-4000-8000-000000000001', 'Polizeivollzugsdienst (Theorie)', 3, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0005-4000-8000-000000000001', 'd1000000-0005-4000-8000-000000000001', 'Zollbeamte mittlerer/gehobener Dienst', 3, 'queued', 'EXAM_FIRST', 0)
ON CONFLICT (id) DO NOTHING;
