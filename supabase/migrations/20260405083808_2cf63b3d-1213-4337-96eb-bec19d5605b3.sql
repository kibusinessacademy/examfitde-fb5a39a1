
-- Fix 1: Create missing certifications (with validation_profile)
INSERT INTO public.certifications (id, title, slug, certification_type, track, validation_profile, active)
VALUES
  ('c5bc6ac9-649b-4276-a521-61707f06d8e5', 'Kaufmann/-frau für Büromanagement', 'kaufmann-fuer-bueromanagement', 'ausbildung', 'AUSBILDUNG_VOLL', 'CERT_VOCATIONAL', true),
  ('9a94843f-f54b-4847-89b8-b2c8bbe4ca02', 'Fachkraft für Lagerlogistik', 'fachkraft-fuer-lagerlogistik', 'ausbildung', 'AUSBILDUNG_VOLL', 'CERT_VOCATIONAL', true),
  ('2b1faa99-c774-4a58-b4e7-aff6125151f6', 'Kraftfahrzeugmechatroniker/-in', 'kraftfahrzeugmechatroniker', 'ausbildung', 'AUSBILDUNG_VOLL', 'CERT_VOCATIONAL', true),
  ('88c30f3f-f1bd-4673-9915-fca3b5748669', 'Verkäufer/-in', 'verkaeufer', 'ausbildung', 'AUSBILDUNG_VOLL', 'CERT_VOCATIONAL', true)
ON CONFLICT (id) DO NOTHING;

-- Fix 2: Link curricula
UPDATE public.curricula SET certification_id = 'c5bc6ac9-649b-4276-a521-61707f06d8e5'
WHERE id = '33eb7832-8c80-46fa-a3ad-a9a5ee996e87' AND certification_id IS NULL;

UPDATE public.curricula SET certification_id = '9a94843f-f54b-4847-89b8-b2c8bbe4ca02'
WHERE id = '516618c7-ba4d-4e1a-bee6-b609b513ebd3' AND certification_id IS NULL;

UPDATE public.curricula SET certification_id = '2b1faa99-c774-4a58-b4e7-aff6125151f6'
WHERE id = 'fbc805ce-e798-4cf6-a189-20f147ae0f38' AND certification_id IS NULL;

UPDATE public.curricula SET certification_id = '88c30f3f-f1bd-4673-9915-fca3b5748669'
WHERE id = '63635f46-0186-49e7-80c1-67925dbdf638' AND certification_id IS NULL;

-- Fix 3: Clear misleading cancel errors on done steps
UPDATE public.package_steps SET last_error = NULL, updated_at = now()
WHERE package_id IN ('5377ab93-fe17-488c-a266-bdb26b672da7','f2039067-e58a-4e94-9573-b5953d435873')
  AND status = 'done' AND last_error LIKE '%cancelled%';
