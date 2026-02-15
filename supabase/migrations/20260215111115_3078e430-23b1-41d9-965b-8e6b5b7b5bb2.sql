
-- Create both quality tables + realtime in one transaction

CREATE TABLE public.question_quality_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  curriculum_id uuid,
  package_id uuid,
  blueprint_alignment_score numeric(4,3) DEFAULT 0,
  duplicate_score numeric(4,3) DEFAULT 0,
  distractor_quality_score numeric(4,3) DEFAULT 0,
  explanation_depth_score numeric(4,3) DEFAULT 0,
  difficulty_consistency_score numeric(4,3) DEFAULT 0,
  overall_score integer DEFAULT 0,
  flagged_reasons text[] DEFAULT '{}',
  validated_by text DEFAULT 'system',
  validated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_qqm_q ON public.question_quality_metrics(question_id);
CREATE INDEX idx_qqm_p ON public.question_quality_metrics(package_id);
CREATE INDEX idx_qqm_s ON public.question_quality_metrics(overall_score);

ALTER TABLE public.question_quality_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_qqm" ON public.question_quality_metrics FOR SELECT USING (true);
CREATE POLICY "write_qqm" ON public.question_quality_metrics FOR INSERT WITH CHECK (true);
CREATE POLICY "upd_qqm" ON public.question_quality_metrics FOR UPDATE USING (true);

CREATE TABLE public.package_quality_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL UNIQUE,
  total_questions integer DEFAULT 0,
  sampled_questions integer DEFAULT 0,
  avg_blueprint_alignment numeric(4,3) DEFAULT 0,
  avg_distractor_quality numeric(4,3) DEFAULT 0,
  avg_explanation_depth numeric(4,3) DEFAULT 0,
  duplicate_rate numeric(5,2) DEFAULT 0,
  difficulty_distribution jsonb DEFAULT '{}',
  quality_score integer DEFAULT 0,
  quality_badge text DEFAULT 'bronze',
  top_issues jsonb DEFAULT '[]',
  flagged_count integer DEFAULT 0,
  last_audit_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pqs_p ON public.package_quality_summary(package_id);
CREATE INDEX idx_pqs_s ON public.package_quality_summary(quality_score);

ALTER TABLE public.package_quality_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_pqs" ON public.package_quality_summary FOR SELECT USING (true);
CREATE POLICY "write_pqs" ON public.package_quality_summary FOR INSERT WITH CHECK (true);
CREATE POLICY "upd_pqs" ON public.package_quality_summary FOR UPDATE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.question_quality_metrics;
ALTER PUBLICATION supabase_realtime ADD TABLE public.package_quality_summary;
