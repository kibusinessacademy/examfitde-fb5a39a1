
-- Table for tracking MiniCheck audit runs
CREATE TABLE public.minicheck_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id UUID NOT NULL,
  batch_start INTEGER NOT NULL DEFAULT 0,
  batch_end INTEGER NOT NULL DEFAULT 0,
  questions_checked INTEGER NOT NULL DEFAULT 0,
  errors_found INTEGER NOT NULL DEFAULT 0,
  errors_fixed INTEGER NOT NULL DEFAULT 0,
  error_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'running',
  run_type TEXT NOT NULL DEFAULT 'nightly',
  model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track which questions have been audited (watermark approach)
ALTER TABLE public.minicheck_questions 
  ADD COLUMN IF NOT EXISTS last_audited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audit_status TEXT;

-- Index for finding unaudited questions efficiently
CREATE INDEX IF NOT EXISTS idx_minicheck_questions_unaudited 
  ON public.minicheck_questions (curriculum_id, created_at) 
  WHERE last_audited_at IS NULL AND status = 'approved';

-- Index for audit log queries
CREATE INDEX IF NOT EXISTS idx_minicheck_audit_log_curriculum 
  ON public.minicheck_audit_log (curriculum_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.minicheck_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read access via has_role
CREATE POLICY "Admins can view audit logs"
  ON public.minicheck_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No direct insert/update from clients — only service role
CREATE POLICY "Service role can manage audit logs"
  ON public.minicheck_audit_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
