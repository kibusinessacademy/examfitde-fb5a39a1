
-- =============================================
-- 1) course_package_reviews table
-- =============================================
CREATE TABLE IF NOT EXISTS public.course_package_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_package_id uuid NOT NULL UNIQUE REFERENCES public.course_packages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','ready','reviewing','approved','rejected')),
  integrity_score int,
  integrity_report jsonb,
  export_json jsonb,
  export_path text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cpr_status ON public.course_package_reviews(status);

ALTER TABLE public.course_package_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_reviews" ON public.course_package_reviews
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_update_reviews" ON public.course_package_reviews
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Service role handles inserts (edge functions), no anon insert policy needed.

-- =============================================
-- 2) Extend admin_notifications with entity columns + is_read
-- =============================================
ALTER TABLE public.admin_notifications
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_admin_notif_unread ON public.admin_notifications(is_read) WHERE is_read = false;

-- RLS for admin_notifications (if not already set)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_notifications' AND policyname = 'admin_read_notifications'
  ) THEN
    EXECUTE 'CREATE POLICY admin_read_notifications ON public.admin_notifications FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin'')
    )';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_notifications' AND policyname = 'admin_update_notifications'
  ) THEN
    EXECUTE 'CREATE POLICY admin_update_notifications ON public.admin_notifications FOR UPDATE USING (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin'')
    )';
  END IF;
END $$;
