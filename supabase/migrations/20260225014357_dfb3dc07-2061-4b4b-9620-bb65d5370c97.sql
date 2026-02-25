
-- Add elite hardening tracking columns to course_packages
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS elite_hardening_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS elite_hardened_at timestamptz;
