
-- For packages with NULL certification_id, create a cert and link everything
-- Step 1: Create certs for packages that have NO certification_id at all
DO $$
DECLARE
  r RECORD;
  new_cert_id UUID;
  slug_val TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT cp.id as pkg_id, cp.title as pkg_title, cp.curriculum_id, 
           cp.track, cp.certification_type, cp.status
    FROM course_packages cp
    JOIN curricula c ON c.id = cp.curriculum_id
    WHERE c.certification_id IS NULL
      AND cp.certification_id IS NULL
  LOOP
    new_cert_id := gen_random_uuid();
    slug_val := LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(NULLIF(r.pkg_title, ''), 'auto-' || r.pkg_id::text), '[^a-zA-Z0-9äöüÄÖÜß-]', '-', 'g'), '-+', '-', 'g'));
    
    INSERT INTO public.certifications (id, title, slug, certification_type, track, validation_profile, active)
    VALUES (
      new_cert_id,
      COALESCE(NULLIF(r.pkg_title, ''), 'Auto-Generated'),
      slug_val,
      COALESCE(r.certification_type, 'ausbildung'),
      COALESCE(r.track, 'AUSBILDUNG_VOLL'),
      CASE 
        WHEN r.track = 'STUDIUM' THEN 'CERT_ACADEMIC'
        WHEN r.certification_type IN ('fortbildung_ihk','fortbildung_hwk') THEN 'CERT_TECH'
        ELSE 'CERT_VOCATIONAL'
      END,
      true
    )
    ON CONFLICT (slug) DO NOTHING;
    
    -- Link package
    UPDATE public.course_packages SET certification_id = new_cert_id WHERE id = r.pkg_id AND certification_id IS NULL;
    
    -- Link curriculum
    UPDATE public.curricula SET certification_id = new_cert_id WHERE id = r.curriculum_id AND certification_id IS NULL;
  END LOOP;
END $$;
