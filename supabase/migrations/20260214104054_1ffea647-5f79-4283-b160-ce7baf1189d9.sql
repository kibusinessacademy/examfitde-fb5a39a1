
-- Add proper curriculum_id column to course_packages
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS curriculum_id uuid;

-- Backfill from certification_id (which was used as curriculum_id)
UPDATE public.course_packages
SET curriculum_id = certification_id
WHERE curriculum_id IS NULL AND certification_id IS NOT NULL;

-- Add FK constraint
ALTER TABLE public.course_packages
  ADD CONSTRAINT course_packages_curriculum_id_fkey
  FOREIGN KEY (curriculum_id) REFERENCES public.curricula(id);

-- Make certification_id nullable (it was being misused)
-- and drop the old FK that incorrectly pointed curricula
ALTER TABLE public.course_packages
  DROP CONSTRAINT IF EXISTS course_packages_certification_id_fkey;
