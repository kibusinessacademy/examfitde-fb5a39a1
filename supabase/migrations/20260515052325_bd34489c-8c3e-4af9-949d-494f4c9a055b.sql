
CREATE TABLE IF NOT EXISTS public.variant_validation_worker_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid,
  package_id uuid,
  curriculum_id uuid,
  blueprint_id uuid,
  scope text NOT NULL,                       -- 'blueprint' | 'curriculum' | 'package'
  reviewed_count int NOT NULL DEFAULT 0,     -- variants inspected (status='review' in scope)
  rejected_count int NOT NULL DEFAULT 0,     -- transitioned review → rejected
  approved_count int NOT NULL DEFAULT 0,     -- transitioned review → approved (reserved; this worker keeps approval to promote)
  kept_review_count int NOT NULL DEFAULT 0,  -- still review after run (passed gates)
  status_changed_count int GENERATED ALWAYS AS (rejected_count + approved_count) STORED,
  ok boolean NOT NULL,
  noop_reason text,                          -- non-null when reviewed_count=0
  gate_summary jsonb,
  notes jsonb
);

CREATE INDEX IF NOT EXISTS idx_vvwr_pkg_created ON public.variant_validation_worker_result (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vvwr_curr_created ON public.variant_validation_worker_result (curriculum_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vvwr_job ON public.variant_validation_worker_result (job_id);

ALTER TABLE public.variant_validation_worker_result ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vvwr admin read" ON public.variant_validation_worker_result;
CREATE POLICY "vvwr admin read" ON public.variant_validation_worker_result
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.variant_validation_worker_result FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.variant_validation_worker_result TO authenticated;
GRANT INSERT, SELECT ON public.variant_validation_worker_result TO service_role;
