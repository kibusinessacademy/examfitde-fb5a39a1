
-- 1. Add EXAM_FIRST_PLUS to the product_track enum
ALTER TYPE public.product_track ADD VALUE IF NOT EXISTS 'EXAM_FIRST_PLUS';

-- 2. Add certification metadata columns
ALTER TABLE public.certifications
  ADD COLUMN IF NOT EXISTS exam_structure text DEFAULT 'written'
    CHECK (exam_structure IN ('written', 'written_oral', 'written_case_oral')),
  ADD COLUMN IF NOT EXISTS oral_exam_weight text DEFAULT 'none'
    CHECK (oral_exam_weight IN ('none', 'optional', 'required')),
  ADD COLUMN IF NOT EXISTS recommended_question_count int DEFAULT 300;

-- 3. Update the auto-derive trigger to route fortbildung/zertifikat types to EXAM_FIRST_PLUS
CREATE OR REPLACE FUNCTION public.fn_auto_derive_track_from_cert_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.certification_type IS NOT NULL THEN
    NEW.track := CASE NEW.certification_type
      WHEN 'ausbildung'          THEN 'AUSBILDUNG_VOLL'::product_track
      WHEN 'studium'             THEN 'STUDIUM'::product_track
      WHEN 'aufstiegsfortbildung' THEN 'EXAM_FIRST_PLUS'::product_track
      WHEN 'sachkunde'           THEN 'EXAM_FIRST_PLUS'::product_track
      WHEN 'branchenzertifikat'  THEN 'EXAM_FIRST_PLUS'::product_track
      WHEN 'projektmanagement'   THEN 'EXAM_FIRST_PLUS'::product_track
      ELSE COALESCE(NEW.track, 'EXAM_FIRST'::product_track)
    END;
  END IF;
  RETURN NEW;
END;
$$;
