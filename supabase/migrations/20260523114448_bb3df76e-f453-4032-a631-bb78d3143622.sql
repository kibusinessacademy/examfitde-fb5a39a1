-- 1. Unpublish internal pipeline tables from supabase_realtime
ALTER PUBLICATION supabase_realtime DROP TABLE public.auto_heal_log;
ALTER PUBLICATION supabase_realtime DROP TABLE public.coupling_heal_v4_runs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.job_queue;
ALTER PUBLICATION supabase_realtime DROP TABLE public.course_packages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.gate_export_jobs;

-- 2. Restrict realtime.messages INSERT (channel subscriptions) to admins
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname = 'realtime_admin_only_subscriptions'
  ) THEN
    DROP POLICY "realtime_admin_only_subscriptions" ON realtime.messages;
  END IF;
END $$;

CREATE POLICY "realtime_admin_only_subscriptions"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
