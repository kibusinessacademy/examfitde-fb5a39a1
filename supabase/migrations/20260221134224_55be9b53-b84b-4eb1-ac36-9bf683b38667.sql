
-- FIX: Add 'quality_gate_failed' to allowed status values
ALTER TABLE public.course_packages DROP CONSTRAINT course_packages_status_check;

ALTER TABLE public.course_packages ADD CONSTRAINT course_packages_status_check 
  CHECK (status = ANY (ARRAY[
    'planning'::text, 
    'council_review'::text, 
    'queued'::text, 
    'building'::text, 
    'qa'::text, 
    'published'::text, 
    'failed'::text, 
    'blocked'::text, 
    'done'::text,
    'quality_gate_failed'::text
  ]));
