
INSERT INTO curricula (id, title, certification_type, track)
VALUES ('d1000000-0006-4000-8000-000000000001', 'Kaufleute für Umwelt- und Nachhaltigkeitsmanagement', 'ausbildung', 'EXAM_FIRST')
ON CONFLICT (id) DO NOTHING;

INSERT INTO course_packages (id, curriculum_id, title, priority, status, track, build_progress)
VALUES ('d2000000-0006-4000-8000-000000000001', 'd1000000-0006-4000-8000-000000000001', 'Kaufleute für Umwelt- und Nachhaltigkeitsmanagement', 1, 'queued', 'EXAM_FIRST', 0)
ON CONFLICT (id) DO NOTHING;
