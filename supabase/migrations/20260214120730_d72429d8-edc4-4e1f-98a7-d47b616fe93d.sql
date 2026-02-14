-- Add locked_at column to course_packages (used by acquire_next_package_lease)
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;