
-- Extend check constraints for STUDIUM track
ALTER TABLE public.certification_catalog
  DROP CONSTRAINT certification_catalog_catalog_type_check,
  DROP CONSTRAINT certification_catalog_track_check,
  DROP CONSTRAINT certification_catalog_chamber_type_check,
  DROP CONSTRAINT certification_catalog_recognition_type_check;

ALTER TABLE public.certification_catalog
  ADD CONSTRAINT certification_catalog_catalog_type_check
    CHECK (catalog_type = ANY (ARRAY['Ausbildung','Fortbildung_IHK','Fortbildung_HWK','Meister','Sachkunde','Projektmanagement','Branchenzertifikat','Sonstiges','Studium'])),
  ADD CONSTRAINT certification_catalog_track_check
    CHECK (track = ANY (ARRAY['AUSBILDUNG_VOLL','EXAM_FIRST','FACHWIRT','MEISTER','BETRIEBSWIRT','SACHKUNDE','AEVO','PROJEKTMANAGEMENT','STUDIUM'])),
  ADD CONSTRAINT certification_catalog_chamber_type_check
    CHECK (chamber_type = ANY (ARRAY['IHK','HWK','Staatlich','Privat','Universitaet'])),
  ADD CONSTRAINT certification_catalog_recognition_type_check
    CHECK (recognition_type = ANY (ARRAY['public_law','chamber','regulated_trade','private_industry','academic']));

-- Now insert WiInfo catalog entry
INSERT INTO public.certification_catalog (
  id, title, slug, catalog_type, chamber_type, recognition_type,
  exam_format, track, min_question_target, priority_score,
  certification_level, oral_component, learning_field_count,
  exam_complexity_score, math_ratio
) VALUES (
  'c3000000-0004-4000-8000-000000000001',
  'Wirtschaftsinformatik – Modulprüfungen Bachelor',
  'wirtschaftsinformatik-bachelor',
  'Studium',
  'Universitaet',
  'academic',
  '{"oral": true, "written": true, "case_study": false, "presentation": true}'::jsonb,
  'STUDIUM',
  800,
  70,
  'studium',
  true,
  0,
  1.2,
  0.20
) ON CONFLICT DO NOTHING;
