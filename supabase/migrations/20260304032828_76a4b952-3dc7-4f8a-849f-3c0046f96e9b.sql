
-- Temporarily disable immutability + drift guards
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_building_published_drift;

-- Reset 10 incomplete published packages back to building
UPDATE public.course_packages
SET 
  status = 'building',
  published_at = NULL,
  updated_at = now()
WHERE id IN (
  'c0ca4ef0-06f0-4352-b7a5-ae9a4aff1cb4',
  '52cc076a-13ba-4f73-8202-b3f1164bba0f',
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
  'fdf4c23c-be16-43ed-ac0e-aea0ab64665f',
  '38f58d97-20a2-49b5-8ba4-737a7887d521',
  '259894ef-5d62-4692-bd21-a8250fe4b389',
  '52c2fa86-6355-46a4-bfc3-6510fcc6ac04',
  'a9f19137-a004-4850-838a-bdc8f8a705f5',
  '4736039f-2d3d-43dc-ba63-2f666d997415'
)
AND status = 'published';

-- Re-enable guards immediately
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_building_published_drift;
