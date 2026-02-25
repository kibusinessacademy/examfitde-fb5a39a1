
-- Elite Hardening Tracking
CREATE TABLE public.elite_hardening_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'all', -- 'exam_pool', 'minicheck', 'oral_exam', 'all'
  status text NOT NULL DEFAULT 'pending', -- 'pending','running','done','failed'
  
  -- Pre-analysis scores
  pre_scores jsonb DEFAULT '{}',
  -- Post-hardening scores  
  post_scores jsonb DEFAULT '{}',
  
  -- Counters
  exam_questions_upgraded int DEFAULT 0,
  exam_questions_total int DEFAULT 0,
  minichecks_upgraded int DEFAULT 0,
  minichecks_total int DEFAULT 0,
  oral_blueprints_upgraded int DEFAULT 0,
  oral_blueprints_total int DEFAULT 0,
  
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  triggered_by uuid
);

ALTER TABLE public.elite_hardening_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on elite_hardening_runs"
  ON public.elite_hardening_runs FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Track per-item hardening decisions
CREATE TABLE public.elite_hardening_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES elite_hardening_runs(id) ON DELETE CASCADE,
  entity_type text NOT NULL, -- 'exam_question', 'minicheck', 'oral_blueprint'
  entity_id uuid NOT NULL,
  action text NOT NULL, -- 'upgraded', 'skipped', 'failed'
  reason text,
  original_data jsonb,
  upgraded_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.elite_hardening_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on elite_hardening_items"
  ON public.elite_hardening_items FOR ALL
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE INDEX idx_hardening_runs_package ON elite_hardening_runs(package_id);
CREATE INDEX idx_hardening_items_run ON elite_hardening_items(run_id);
CREATE INDEX idx_hardening_items_entity ON elite_hardening_items(entity_type, entity_id);
