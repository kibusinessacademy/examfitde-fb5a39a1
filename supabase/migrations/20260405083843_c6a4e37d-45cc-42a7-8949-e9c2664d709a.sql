
-- ============================================================
-- Bulk Fix 1: Auto-create all missing certifications from package data
-- ============================================================
INSERT INTO public.certifications (id, title, slug, certification_type, track, validation_profile, active)
SELECT DISTINCT
  cp.certification_id,
  COALESCE(NULLIF(cp.title, ''), 'Auto-Generated Certification'),
  LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(NULLIF(cp.title, ''), cp.certification_id::text), '[^a-zA-Z0-9äöüÄÖÜß-]', '-', 'g'), '-+', '-', 'g')),
  COALESCE(cp.certification_type, 'ausbildung'),
  COALESCE(cp.track, 'AUSBILDUNG_VOLL'),
  CASE 
    WHEN cp.track = 'STUDIUM' THEN 'CERT_ACADEMIC'
    WHEN cp.certification_type IN ('fortbildung_ihk','fortbildung_hwk') THEN 'CERT_TECH'
    ELSE 'CERT_VOCATIONAL'
  END,
  true
FROM course_packages cp
LEFT JOIN certifications cert ON cert.id = cp.certification_id
WHERE cert.id IS NULL AND cp.certification_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Bulk Fix 2: Auto-link curricula to certifications where possible
-- Match by: curriculum is referenced by course_packages.curriculum_id
-- and curriculum.certification_id is NULL
-- ============================================================
UPDATE public.curricula c
SET certification_id = cp.certification_id
FROM course_packages cp
WHERE cp.curriculum_id = c.id
  AND c.certification_id IS NULL
  AND cp.certification_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM certifications cert WHERE cert.id = cp.certification_id);
