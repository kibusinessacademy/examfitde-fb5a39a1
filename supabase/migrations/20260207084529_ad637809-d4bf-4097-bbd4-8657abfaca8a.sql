-- AI Tutor Governance: Audit Logging (AZAV-ready)
-- This table logs ALL AI tutor interactions for audit & compliance

CREATE TABLE public.ai_tutor_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID REFERENCES public.exam_sessions(id) ON DELETE SET NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('learning', 'practice', 'exam', 'lesson')),
  mode TEXT NOT NULL CHECK (mode IN ('learning', 'practice', 'exam')),
  prompt_hash TEXT NOT NULL, -- SHA256 of user prompt (privacy)
  response_hash TEXT NOT NULL, -- SHA256 of AI response (audit)
  prompt_length INTEGER NOT NULL,
  response_length INTEGER NOT NULL,
  tokens_used INTEGER,
  was_blocked BOOLEAN NOT NULL DEFAULT false,
  block_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for audit queries
CREATE INDEX idx_ai_tutor_logs_user_id ON public.ai_tutor_logs(user_id);
CREATE INDEX idx_ai_tutor_logs_session_id ON public.ai_tutor_logs(session_id);
CREATE INDEX idx_ai_tutor_logs_mode ON public.ai_tutor_logs(mode);
CREATE INDEX idx_ai_tutor_logs_created_at ON public.ai_tutor_logs(created_at DESC);
CREATE INDEX idx_ai_tutor_logs_was_blocked ON public.ai_tutor_logs(was_blocked) WHERE was_blocked = true;

-- Enable RLS
ALTER TABLE public.ai_tutor_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own logs
CREATE POLICY "Users can view their own tutor logs"
ON public.ai_tutor_logs
FOR SELECT
USING (auth.uid() = user_id);

-- Only backend can insert logs (service role)
CREATE POLICY "Service role can insert tutor logs"
ON public.ai_tutor_logs
FOR INSERT
WITH CHECK (true);

-- Admins can view all logs for auditing (check user_roles directly)
CREATE POLICY "Admins can view all tutor logs"
ON public.ai_tutor_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

-- Add comment for documentation
COMMENT ON TABLE public.ai_tutor_logs IS 'AZAV-compliant audit log for all AI tutor interactions. Tracks mode enforcement and blocked requests.';