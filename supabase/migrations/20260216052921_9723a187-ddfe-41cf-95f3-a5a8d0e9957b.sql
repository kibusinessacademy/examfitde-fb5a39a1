
-- ============================================================
-- 1) OUTCOME TRACKING (Bestehensquoten, Time-to-Pass, etc.)
-- ============================================================
CREATE TABLE public.outcome_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  first_attempt_at TIMESTAMPTZ,
  pass_simulation_at TIMESTAMPTZ,
  days_to_pass INTEGER,
  attempts_total INTEGER DEFAULT 0,
  best_score NUMERIC(5,2) DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  scores_7d NUMERIC(5,2)[] DEFAULT '{}',
  scores_14d NUMERIC(5,2)[] DEFAULT '{}',
  scores_30d NUMERIC(5,2)[] DEFAULT '{}',
  improvement_pct NUMERIC(5,2) DEFAULT 0,
  drop_off_count INTEGER DEFAULT 0,
  last_session_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, curriculum_id)
);

ALTER TABLE public.outcome_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own outcomes" ON public.outcome_tracking
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service inserts outcomes" ON public.outcome_tracking
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Service updates outcomes" ON public.outcome_tracking
  FOR UPDATE USING (true);

CREATE INDEX idx_outcome_tracking_user ON public.outcome_tracking(user_id);
CREATE INDEX idx_outcome_tracking_curriculum ON public.outcome_tracking(curriculum_id);

-- ============================================================
-- 2) SKILL GRAPH (Kompetenz-Knoten + User-Scores)
-- ============================================================
CREATE TABLE public.skill_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_id UUID NOT NULL,
  lernfeld TEXT NOT NULL,
  kompetenz TEXT NOT NULL,
  mikro_skill TEXT NOT NULL,
  description TEXT,
  weight NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(curriculum_id, lernfeld, kompetenz, mikro_skill)
);

ALTER TABLE public.skill_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads skill_nodes" ON public.skill_nodes FOR SELECT USING (true);
CREATE POLICY "Service manages skill_nodes" ON public.skill_nodes FOR ALL USING (true);

CREATE INDEX idx_skill_nodes_curriculum ON public.skill_nodes(curriculum_id);

-- Map questions to skills
CREATE TABLE public.question_skill_map (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  skill_node_id UUID NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  relevance NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, skill_node_id)
);

ALTER TABLE public.question_skill_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads qsm" ON public.question_skill_map FOR SELECT USING (true);
CREATE POLICY "Service manages qsm" ON public.question_skill_map FOR ALL USING (true);

-- User skill scores (aggregated per skill node)
CREATE TABLE public.user_skill_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  skill_node_id UUID NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  mastery_pct NUMERIC(5,2) DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  trend TEXT DEFAULT 'stable' CHECK (trend IN ('improving','stable','declining')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_node_id)
);

ALTER TABLE public.user_skill_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own skill scores" ON public.user_skill_scores
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service manages skill scores" ON public.user_skill_scores
  FOR ALL USING (true);

CREATE INDEX idx_uss_user ON public.user_skill_scores(user_id);
CREATE INDEX idx_uss_skill ON public.user_skill_scores(skill_node_id);

-- ============================================================
-- 3) CANARY RELEASES
-- ============================================================
CREATE TABLE public.canary_releases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  engine_version TEXT NOT NULL,
  traffic_pct NUMERIC(5,2) DEFAULT 5.0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','promoted','rolled_back','paused')),
  baseline_version TEXT NOT NULL,
  metrics_baseline JSONB DEFAULT '{}',
  metrics_canary JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  auto_promote_threshold NUMERIC(5,2) DEFAULT 5.0,
  auto_rollback_threshold NUMERIC(5,2) DEFAULT -5.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.canary_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read canary" ON public.canary_releases FOR SELECT USING (true);
CREATE POLICY "Service manages canary" ON public.canary_releases FOR ALL USING (true);

-- Golden Exam Sets
CREATE TABLE public.golden_exam_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  question_ids UUID[] NOT NULL DEFAULT '{}',
  benchmark_metrics JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.golden_exam_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads golden sets" ON public.golden_exam_sets FOR SELECT USING (true);
CREATE POLICY "Service manages golden sets" ON public.golden_exam_sets FOR ALL USING (true);

CREATE INDEX idx_golden_exam_curriculum ON public.golden_exam_sets(curriculum_id);

-- Drift detection snapshots
CREATE TABLE public.drift_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_version TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  avg_quality_score NUMERIC(5,2),
  avg_discrimination NUMERIC(5,4),
  avg_praxis_score NUMERIC(5,2),
  style_rejection_rate NUMERIC(5,4),
  sample_size INTEGER DEFAULT 0,
  drift_alert BOOLEAN DEFAULT false,
  drift_detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.drift_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads drift" ON public.drift_snapshots FOR SELECT USING (true);
CREATE POLICY "Service manages drift" ON public.drift_snapshots FOR ALL USING (true);
