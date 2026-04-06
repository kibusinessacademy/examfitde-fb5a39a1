
-- Curricula
INSERT INTO curricula (id, title, certification_type, track) VALUES
  ('d1000000-0010-4000-8000-000000000001', 'Versicherungsvermittler §34d GewO', 'branchenzertifikat', 'EXAM_FIRST_PLUS'),
  ('d1000000-0011-4000-8000-000000000001', 'Immobilienverwalter IHK', 'fortbildung_ihk', 'EXAM_FIRST_PLUS'),
  ('d1000000-0012-4000-8000-000000000001', 'Fachverwalter WEG', 'branchenzertifikat', 'EXAM_FIRST'),
  ('d1000000-0013-4000-8000-000000000001', 'Geldwäschebeauftragter (GwG)', 'branchenzertifikat', 'EXAM_FIRST'),
  ('d1000000-0014-4000-8000-000000000001', 'Compliance Officer', 'branchenzertifikat', 'EXAM_FIRST'),
  ('d1000000-0015-4000-8000-000000000001', 'Datenschutzbeauftragter (DSGVO)', 'branchenzertifikat', 'EXAM_FIRST'),
  ('d1000000-0016-4000-8000-000000000001', 'Sicherheitsbeauftragter', 'branchenzertifikat', 'EXAM_FIRST'),
  ('d1000000-0017-4000-8000-000000000001', 'Brandschutzbeauftragter', 'branchenzertifikat', 'EXAM_FIRST'),
  ('d1000000-0018-4000-8000-000000000001', 'Gefahrstoffbeauftragter', 'branchenzertifikat', 'EXAM_FIRST'),
  ('d1000000-0019-4000-8000-000000000001', 'Gefahrgutbeauftragter (ADR)', 'branchenzertifikat', 'EXAM_FIRST')
ON CONFLICT (id) DO NOTHING;

-- Pakete
INSERT INTO course_packages (id, curriculum_id, title, priority, status, track, build_progress) VALUES
  ('d2000000-0010-4000-8000-000000000001', 'd1000000-0010-4000-8000-000000000001', 'Versicherungsvermittler §34d GewO', 1, 'queued', 'EXAM_FIRST_PLUS', 0),
  ('d2000000-0011-4000-8000-000000000001', 'd1000000-0011-4000-8000-000000000001', 'Immobilienverwalter IHK', 2, 'queued', 'EXAM_FIRST_PLUS', 0),
  ('d2000000-0012-4000-8000-000000000001', 'd1000000-0012-4000-8000-000000000001', 'Fachverwalter WEG', 2, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0013-4000-8000-000000000001', 'd1000000-0013-4000-8000-000000000001', 'Geldwäschebeauftragter (GwG)', 2, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0014-4000-8000-000000000001', 'd1000000-0014-4000-8000-000000000001', 'Compliance Officer', 2, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0015-4000-8000-000000000001', 'd1000000-0015-4000-8000-000000000001', 'Datenschutzbeauftragter (DSGVO)', 2, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0016-4000-8000-000000000001', 'd1000000-0016-4000-8000-000000000001', 'Sicherheitsbeauftragter', 3, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0017-4000-8000-000000000001', 'd1000000-0017-4000-8000-000000000001', 'Brandschutzbeauftragter', 3, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0018-4000-8000-000000000001', 'd1000000-0018-4000-8000-000000000001', 'Gefahrstoffbeauftragter', 3, 'queued', 'EXAM_FIRST', 0),
  ('d2000000-0019-4000-8000-000000000001', 'd1000000-0019-4000-8000-000000000001', 'Gefahrgutbeauftragter (ADR)', 3, 'queued', 'EXAM_FIRST', 0)
ON CONFLICT (id) DO NOTHING;
