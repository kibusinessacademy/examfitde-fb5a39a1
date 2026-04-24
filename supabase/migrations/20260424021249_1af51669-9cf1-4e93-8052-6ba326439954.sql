-- ============================================================
-- P0 #1: ops_budget_exhausted_log — entfernt anon-write/read
-- ============================================================
DROP POLICY IF EXISTS "Service role full access on budget_exhausted_log"
  ON public.ops_budget_exhausted_log;

CREATE POLICY "service_role_all_budget_log"
  ON public.ops_budget_exhausted_log
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "admin_read_budget_log"
  ON public.ops_budget_exhausted_log
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- P0 #2: exam_question_variants — admin-only SELECT (mirror exam_questions)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can read variants"
  ON public.exam_question_variants;

-- recreate clean admin-only SELECT
DROP POLICY IF EXISTS "Only admins can view variants" ON public.exam_question_variants;
CREATE POLICY "Only admins can view variants"
  ON public.exam_question_variants
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- P0 #3: realtime.messages — enable RLS, admin-only fallback policy
-- (App-channels publish via service_role / postgres_changes; user channels
--  must be explicitly added as needed.)
-- ============================================================
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Admin can subscribe to anything (debug / ops monitoring)
DROP POLICY IF EXISTS "admin_realtime_all" ON realtime.messages;
CREATE POLICY "admin_realtime_all"
  ON realtime.messages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Service role full access (Edge functions broadcasting events)
DROP POLICY IF EXISTS "service_role_realtime_all" ON realtime.messages;
CREATE POLICY "service_role_realtime_all"
  ON realtime.messages
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- P1: package_quality_summary, question_quality_metrics, concurrency_snapshots
-- Drop public-INSERT policies; service_role-only writes already exist.
-- ============================================================
DROP POLICY IF EXISTS "write_pqs" ON public.package_quality_summary;
DROP POLICY IF EXISTS "write_qqm" ON public.question_quality_metrics;
DROP POLICY IF EXISTS "Service insert concurrency" ON public.concurrency_snapshots;
