-- Discrimination index tracking: store per-question performance metrics
CREATE TABLE IF NOT EXISTS public.question_discrimination_stats (
  question_id uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  total_attempts int NOT NULL DEFAULT 0,
  correct_count int NOT NULL DEFAULT 0,
  top_quartile_correct_rate numeric(5,4) DEFAULT 0,
  bottom_quartile_correct_rate numeric(5,4) DEFAULT 0,
  discrimination_index numeric(5,4) DEFAULT 0,
  last_calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id)
);

ALTER TABLE public.question_discrimination_stats ENABLE ROW LEVEL SECURITY;

-- Admin-only read access
CREATE POLICY "Admin read discrimination stats"
  ON public.question_discrimination_stats FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Service role can write (edge functions)
CREATE POLICY "Service write discrimination stats"
  ON public.question_discrimination_stats FOR ALL
  USING (true) WITH CHECK (true);

-- Index for quick lookups
CREATE INDEX idx_discrimination_low ON public.question_discrimination_stats (discrimination_index)
  WHERE discrimination_index < 0.20;

COMMENT ON TABLE public.question_discrimination_stats IS 'Per-question performance metrics for quality-driven pool management';