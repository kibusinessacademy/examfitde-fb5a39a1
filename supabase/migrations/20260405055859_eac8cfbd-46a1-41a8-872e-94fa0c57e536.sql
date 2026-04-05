
INSERT INTO curricula (id, title, version)
VALUES (
  'd9000000-0002-4000-8000-000000000001',
  'Fachinformatiker/-in Digitale Vernetzung',
  1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO courses (id, title, curriculum_id)
VALUES (
  'c9000000-0002-4000-8000-000000000001',
  'Fachinformatiker/-in Digitale Vernetzung – IHK Prüfungsvorbereitung',
  'd9000000-0002-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
