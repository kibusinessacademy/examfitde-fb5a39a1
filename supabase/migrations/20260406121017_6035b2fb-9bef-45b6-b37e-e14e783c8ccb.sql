-- Add persona_profile column to course_packages
ALTER TABLE public.course_packages
ADD COLUMN persona_profile text NOT NULL DEFAULT 'AZUBI_LOW_ROI';

-- Add check constraint for valid values
ALTER TABLE public.course_packages
ADD CONSTRAINT chk_persona_profile CHECK (
  persona_profile IN ('AZUBI_HIGH_ROI', 'AZUBI_LOW_ROI', 'SACHKUNDE', 'FACHWIRT', 'STUDIUM')
);

-- Auto-populate based on existing track values (cast enum to text)
UPDATE public.course_packages SET persona_profile = 'STUDIUM'
WHERE track::text IN ('STUDIUM');

UPDATE public.course_packages SET persona_profile = 'SACHKUNDE'
WHERE track::text IN ('EXAM_FIRST');

UPDATE public.course_packages SET persona_profile = 'FACHWIRT'
WHERE track::text IN ('EXAM_FIRST_PLUS');

-- AUSBILDUNG_VOLL stays as default AZUBI_LOW_ROI

-- Index for fast filtering
CREATE INDEX idx_course_packages_persona ON public.course_packages (persona_profile);