-- Add integrity_profile column
ALTER TABLE public.course_packages
ADD COLUMN IF NOT EXISTS integrity_profile text;

-- Add constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_packages_integrity_profile_check'
  ) THEN
    ALTER TABLE public.course_packages
    ADD CONSTRAINT course_packages_integrity_profile_check
    CHECK (
      integrity_profile IS NULL OR integrity_profile IN (
        'AUSBILDUNG_VOLL',
        'AUSBILDUNG_LIGHT',
        'STUDIUM',
        'WEITERBILDUNG'
      )
    );
  END IF;
END $$;

-- Backfill STUDIUM
UPDATE public.course_packages
SET integrity_profile = 'STUDIUM'
WHERE track = 'STUDIUM'
  AND integrity_profile IS NULL;

-- Backfill everything else
UPDATE public.course_packages
SET integrity_profile = 'AUSBILDUNG_VOLL'
WHERE (track IS NULL OR track <> 'STUDIUM')
  AND integrity_profile IS NULL;