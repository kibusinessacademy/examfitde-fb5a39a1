ALTER TABLE public.learner_course_grants
  DROP CONSTRAINT IF EXISTS learner_course_grants_status_check;
ALTER TABLE public.learner_course_grants
  ADD CONSTRAINT learner_course_grants_status_check
  CHECK (status = ANY (ARRAY['pending'::text,'active'::text,'paused'::text,'completed'::text,'revoked'::text,'refunded'::text]));