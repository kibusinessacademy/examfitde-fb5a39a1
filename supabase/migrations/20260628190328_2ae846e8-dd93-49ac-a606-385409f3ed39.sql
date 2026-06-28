
-- SELLABLE.DISPATCHER.OS.1: extend admin_course_auto_heal_queue for dispatcher
ALTER TABLE public.admin_course_auto_heal_queue
  DROP CONSTRAINT IF EXISTS admin_course_auto_heal_queue_status_check;

ALTER TABLE public.admin_course_auto_heal_queue
  ADD CONSTRAINT admin_course_auto_heal_queue_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'processing'::text,
    'done'::text,
    'failed'::text,
    'cancelled'::text,
    'skipped'::text,
    'manual_review'::text
  ]));

ALTER TABLE public.admin_course_auto_heal_queue
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_dispatched_job_id uuid,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS claim_token uuid;

CREATE INDEX IF NOT EXISTS idx_acahq_status_action_created
  ON public.admin_course_auto_heal_queue (status, heal_action, created_at);
