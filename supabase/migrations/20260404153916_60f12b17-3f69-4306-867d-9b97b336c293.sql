
-- Auto-derive track from certification_type on course_packages
CREATE OR REPLACE FUNCTION public.auto_derive_track_from_cert_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Only act on insert or when certification_type changes
  IF TG_OP = 'INSERT' OR (OLD.certification_type IS DISTINCT FROM NEW.certification_type) THEN
    CASE NEW.certification_type::text
      WHEN 'studium' THEN
        NEW.track := 'STUDIUM'::product_track;
      WHEN 'fortbildung_ihk', 'fortbildung_hwk', 'aufstiegsfortbildung' THEN
        NEW.track := 'FORTBILDUNG'::product_track;
      WHEN 'branchenzertifikat', 'projektmanagement', 'sachkunde' THEN
        NEW.track := 'ZERTIFIKAT'::product_track;
      ELSE
        -- Keep existing track on update, default on insert handled by column default
        NULL;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_derive_track_from_cert_type
  BEFORE INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_derive_track_from_cert_type();
