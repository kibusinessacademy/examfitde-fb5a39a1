
ALTER TABLE public.course_packages 
  ADD COLUMN IF NOT EXISTS integrity_report_version_num integer DEFAULT 0;
