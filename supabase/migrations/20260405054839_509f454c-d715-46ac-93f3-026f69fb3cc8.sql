
-- 1) Fix validate_course_package_track trigger type mismatch
CREATE OR REPLACE FUNCTION validate_course_package_track()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed_tracks product_track[] := ARRAY[
    'AUSBILDUNG_VOLL'::product_track, 'EXAM_FIRST'::product_track, 'STUDIUM'::product_track,
    'FORTBILDUNG'::product_track, 'ZERTIFIKAT'::product_track
  ];
BEGIN
  IF NEW.track IS NOT NULL AND NOT (NEW.track = ANY(allowed_tracks)) THEN
    RAISE EXCEPTION 'INVALID_TRACK: "%" is not a valid track. Allowed: %', NEW.track, array_to_string(allowed_tracks::text[], ', ');
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Track switches to EXAM_FIRST
SET LOCAL app.track_switch_authorized = 'true';
UPDATE course_packages SET track = 'EXAM_FIRST'::product_track
WHERE id IN (
  '1208d05e-df2f-438e-94c1-060b85dd4915',
  '78c8dc3a-9e8e-451e-931c-a8d944a6d7cf',
  '047bc325-5244-4f21-affd-5395bf62bcff',
  'adce63f4-03ba-49ec-964c-c35e3984a591',
  '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081',
  '55edacdf-5230-4e9a-b9c1-dcde00b8cd47'
);

-- 3) Fahrzeugtechnik program
INSERT INTO programs (id, title, slug, canonical_title, program_type, cluster, priority_wave, study_mode, status, aliases, degree_type)
VALUES (
  'b1000000-0033-4000-8000-000000000001',
  'Fahrzeugtechnik / Fahrzeugbau',
  'fahrzeugtechnik',
  'Fahrzeugtechnik / Fahrzeugbau',
  'higher_education',
  'technik',
  1,
  'dual',
  'active',
  ARRAY['Fahrzeuginformatik', 'Fahrzeugbau', 'Automotive Engineering'],
  'Bachelor of Engineering'
)
ON CONFLICT (id) DO NOTHING;

-- 4) Curriculum for FI Daten- und Prozessanalyse
INSERT INTO curricula (id, title, version)
VALUES (
  'd9000000-0001-4000-8000-000000000001',
  'Fachinformatiker/-in Daten- und Prozessanalyse – IHK Prüfungsvorbereitung',
  1
)
ON CONFLICT (id) DO NOTHING;

-- 5) Course for FI Daten- und Prozessanalyse
INSERT INTO courses (id, title, curriculum_id)
VALUES (
  'c9000000-0001-4000-8000-000000000001',
  'Fachinformatiker/-in Daten- und Prozessanalyse – IHK Prüfungsvorbereitung',
  'd9000000-0001-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
