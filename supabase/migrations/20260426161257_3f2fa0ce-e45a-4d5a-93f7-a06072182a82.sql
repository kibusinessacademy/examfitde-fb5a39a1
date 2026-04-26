-- Admin AI Page Analysis Log: persistent history per route
CREATE TABLE IF NOT EXISTS public.admin_ai_analysis_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key TEXT NOT NULL,
  route_path TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  bottlenecks JSONB,
  gaps JSONB,
  optimizations JSONB,
  cross_system JSONB,
  next_actions JSONB,
  markdown TEXT,
  latency_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_ai_analysis_log_route_created
  ON public.admin_ai_analysis_log (route_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_ai_analysis_log_user
  ON public.admin_ai_analysis_log (user_id, created_at DESC);

ALTER TABLE public.admin_ai_analysis_log ENABLE ROW LEVEL SECURITY;

-- Only admins may read or insert
DROP POLICY IF EXISTS "admin_ai_analysis_log_admin_select" ON public.admin_ai_analysis_log;
CREATE POLICY "admin_ai_analysis_log_admin_select"
  ON public.admin_ai_analysis_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin_ai_analysis_log_admin_insert" ON public.admin_ai_analysis_log;
CREATE POLICY "admin_ai_analysis_log_admin_insert"
  ON public.admin_ai_analysis_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Service role bypasses RLS by design (used by edge function)
COMMENT ON TABLE public.admin_ai_analysis_log IS
  'Persistent history of AI page analyses per admin route. Limited to last 5 in UI per route_key. Admin-only.';