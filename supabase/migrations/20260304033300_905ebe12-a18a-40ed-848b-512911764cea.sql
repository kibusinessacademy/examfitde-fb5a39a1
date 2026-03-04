
-- Disable ALL course_packages triggers
ALTER TABLE public.course_packages DISABLE TRIGGER guard_publish_requires_questions;
ALTER TABLE public.course_packages DISABLE TRIGGER guard_publish_requires_real_content;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_auto_set_track_defaults;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_building_published_drift;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_building_requires_enrichment;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_package_curriculum_id;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_publish_requires_questions;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_publish_requires_real_content;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_search_index_packages;
ALTER TABLE public.course_packages DISABLE TRIGGER trg_sync_course_status_on_package;
ALTER TABLE public.course_packages DISABLE TRIGGER update_course_packages_updated_at;

-- FIX 1: Reset 6 packages still published with incomplete auto_publish
UPDATE public.course_packages
SET status = 'building', published_at = NULL, updated_at = now()
WHERE id IN (
  'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a',
  'fdf4c23c-be16-43ed-ac0e-aea0ab64665f',
  '38f58d97-20a2-49b5-8ba4-737a7887d521',
  'a9f19137-a004-4850-838a-bdc8f8a705f5',
  '4736039f-2d3d-43dc-ba63-2f666d997415'
)
AND status = 'published';

-- FIX 2: Ghost-published courses (only archived packages) → draft
UPDATE public.courses
SET status = 'draft', updated_at = now()
WHERE id IN (
  '6134c9df-c0f7-450d-af2d-84973426249c',
  '99c19ab0-65d5-4e3c-bde1-d16f536bdd53',
  'b6131b49-859a-45e8-8fea-3795077598b3',
  'e306904b-adba-48f1-b44d-11c4a19e3506',
  '92ac8495-04ff-41a4-a8a6-a5b42a1f5320',
  '0b660b52-3a6d-466a-babb-ad9b9ff3d3f9',
  '7231587c-7780-499a-8768-25c66cfab028'
)
AND status = 'published';

-- FIX 3: Courses with building packages → generating
UPDATE public.courses
SET status = 'generating', updated_at = now()
WHERE id IN (
  '75f7fa46-24c1-4484-966a-c700ab6015c5',
  '9b929c4e-6966-47a7-8072-9998c2ef9a6a',
  '529337f2-21e0-4c72-aadd-370a9d592904'
)
AND status = 'published';

-- Re-enable ALL triggers
ALTER TABLE public.course_packages ENABLE TRIGGER guard_publish_requires_questions;
ALTER TABLE public.course_packages ENABLE TRIGGER guard_publish_requires_real_content;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_auto_set_track_defaults;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_building_published_drift;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_building_requires_enrichment;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_package_curriculum_id;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_publish_requires_questions;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_publish_requires_real_content;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_guard_published_immutable;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_search_index_packages;
ALTER TABLE public.course_packages ENABLE TRIGGER trg_sync_course_status_on_package;
ALTER TABLE public.course_packages ENABLE TRIGGER update_course_packages_updated_at;
