
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_course_auto_heal_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  source_test_run_id uuid NULL,
  source text NOT NULL DEFAULT 'qa_feedback',
  reason_codes text[] NOT NULL DEFAULT '{}',
  heal_action text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_auto_heal_queue_package
  ON public.admin_course_auto_heal_queue(package_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_auto_heal_queue_status
  ON public.admin_course_auto_heal_queue(status, created_at DESC);

ALTER TABLE public.admin_course_auto_heal_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read auto heal queue"
  ON public.admin_course_auto_heal_queue
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

CREATE POLICY "Admins can insert auto heal queue"
  ON public.admin_course_auto_heal_queue
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

CREATE POLICY "Admins can update auto heal queue"
  ON public.admin_course_auto_heal_queue
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

GRANT ALL ON public.admin_course_auto_heal_queue TO service_role;

CREATE OR REPLACE FUNCTION public.trg_admin_auto_heal_queue_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IN ('done', 'failed', 'cancelled') AND NEW.processed_at IS NULL THEN
    NEW.processed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_auto_heal_queue_updated_at ON public.admin_course_auto_heal_queue;
CREATE TRIGGER trg_admin_auto_heal_queue_updated_at
BEFORE UPDATE ON public.admin_course_auto_heal_queue
FOR EACH ROW EXECUTE FUNCTION public.trg_admin_auto_heal_queue_updated_at();

COMMIT;
