
ALTER TABLE public.certifications DROP CONSTRAINT certifications_track_check;
ALTER TABLE public.certifications ADD CONSTRAINT certifications_track_check 
  CHECK (track = ANY (ARRAY['AUSBILDUNG'::text, 'STUDIUM'::text, 'FORTBILDUNG'::text, 'CERTIFICATION'::text, 'EXAM_FIRST'::text, 'EXAM_FIRST_PLUS'::text, 'ZERTIFIKAT'::text, 'AUSBILDUNG_VOLL'::text]));
