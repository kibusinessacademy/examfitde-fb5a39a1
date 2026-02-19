
-- ═══════════════════════════════════════════════════════════════════════════
-- Mastery-Feedback-Loop: competency_performance_stats
-- Aggregated per-competency performance for adaptive content generation
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.competency_performance_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_id UUID NOT NULL,
  competency_id UUID,
  learning_field_id UUID,
  topic_key TEXT,
  
  -- Aggregated metrics
  total_attempts INT NOT NULL DEFAULT 0,
  total_correct INT NOT NULL DEFAULT 0,
  avg_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  fail_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  
  -- Error pattern tracking  
  common_error_patterns JSONB DEFAULT '[]'::jsonb,
  
  -- Quality metadata
  avg_impact_score NUMERIC(4,3) DEFAULT NULL,
  avg_hallucination_risk NUMERIC(4,3) DEFAULT NULL,
  regeneration_count INT NOT NULL DEFAULT 0,
  
  -- Status
  fragility_level TEXT NOT NULL DEFAULT 'stable' CHECK (fragility_level IN ('stable', 'fragile', 'critical')),
  
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT uq_competency_perf UNIQUE (curriculum_id, competency_id, learning_field_id, topic_key)
);

-- Enable RLS
ALTER TABLE public.competency_performance_stats ENABLE ROW LEVEL SECURITY;

-- Admin-only read policy (service_role bypasses RLS anyway)
CREATE POLICY "Admins can read competency stats"
  ON public.competency_performance_stats
  FOR SELECT
  USING (true);

-- Index for fast lookups
CREATE INDEX idx_comp_perf_curriculum ON public.competency_performance_stats (curriculum_id);
CREATE INDEX idx_comp_perf_fragility ON public.competency_performance_stats (fragility_level) WHERE fragility_level != 'stable';

-- Enable realtime for admin dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE public.competency_performance_stats;
