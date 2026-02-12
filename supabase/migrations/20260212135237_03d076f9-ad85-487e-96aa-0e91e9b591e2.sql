
-- Add queue_position to course_packages for sequential builds
ALTER TABLE public.course_packages ADD COLUMN IF NOT EXISTS queue_position int;

-- Index for fast queue lookup
CREATE INDEX IF NOT EXISTS idx_course_packages_queue ON public.course_packages (queue_position) WHERE queue_position IS NOT NULL;

-- Function: assign next queue position
CREATE OR REPLACE FUNCTION public.next_package_queue_position()
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE(MAX(queue_position), 0) + 1 FROM public.course_packages WHERE queue_position IS NOT NULL;
$$;
