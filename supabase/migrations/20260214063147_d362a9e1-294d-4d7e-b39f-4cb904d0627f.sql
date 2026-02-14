
-- ═══════════════════════════════════════════════════════════════
-- PART 1: Release A tables + RPCs
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pipeline_capacity (
  id boolean PRIMARY KEY DEFAULT true,
  max_wip int NOT NULL DEFAULT 2,
  min_wip int NOT NULL DEFAULT 1,
  last_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_capacity_singleton CHECK (id = true)
);
INSERT INTO public.pipeline_capacity (id, max_wip, min_wip) VALUES (true, 2, 1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.pipeline_active_packages (
  package_id uuid PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_active_heartbeat ON public.pipeline_active_packages(heartbeat_at);

ALTER TABLE public.pipeline_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_active_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srv_pipeline_cap" ON public.pipeline_capacity FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srv_pipeline_active" ON public.pipeline_active_packages FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP FUNCTION IF EXISTS public.get_active_pipeline_packages();
CREATE FUNCTION public.get_active_pipeline_packages()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT package_id FROM public.pipeline_active_packages ORDER BY claimed_at; $$;
REVOKE ALL ON FUNCTION public.get_active_pipeline_packages() FROM public;
GRANT EXECUTE ON FUNCTION public.get_active_pipeline_packages() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_pipeline_slot(p_package_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max int; v_active int;
BEGIN
  SELECT max_wip INTO v_max FROM public.pipeline_capacity WHERE id = true;
  IF v_max IS NULL THEN v_max := 2; END IF;
  SELECT count(*) INTO v_active FROM public.pipeline_active_packages;
  IF v_active >= v_max THEN RETURN false; END IF;
  INSERT INTO public.pipeline_active_packages(package_id) VALUES (p_package_id)
  ON CONFLICT (package_id) DO UPDATE SET heartbeat_at = now();
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.claim_pipeline_slot(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_pipeline_slot(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.release_pipeline_slot(uuid);
CREATE FUNCTION public.release_pipeline_slot(p_package_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ DELETE FROM public.pipeline_active_packages WHERE package_id = p_package_id; $$;
REVOKE ALL ON FUNCTION public.release_pipeline_slot(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.release_pipeline_slot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_pipeline_slot(p_package_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.pipeline_active_packages SET heartbeat_at = now() WHERE package_id = p_package_id; $$;
REVOKE ALL ON FUNCTION public.heartbeat_pipeline_slot(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.heartbeat_pipeline_slot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_pipeline_capacity(p_max_wip int, p_reason jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.pipeline_capacity SET max_wip = greatest(1, least(6, p_max_wip)), last_decision = p_reason, updated_at = now() WHERE id = true;
END; $$;
REVOKE ALL ON FUNCTION public.set_pipeline_capacity(int,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.set_pipeline_capacity(int,jsonb) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- PART 2: Release B tables
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.jobtype_limits (
  job_type text PRIMARY KEY,
  max_processing int NOT NULL DEFAULT 2
);
INSERT INTO public.jobtype_limits(job_type, max_processing) VALUES
 ('generate_curriculum_content', 6), ('setup_course_package', 6),
 ('package_generate_exam_pool', 2), ('package_generate_oral_exam', 2),
 ('package_build_ai_tutor_index', 2), ('package_generate_handbook', 2),
 ('package_scaffold_learning_course', 2), ('package_run_integrity_check', 1),
 ('package_auto_publish', 1), ('generate_course', 2),
 ('generate_course_batch', 2), ('auto_gap_close', 2),
 ('seo_generate', 2), ('seo_content_batch', 2)
ON CONFLICT (job_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ops_runtime_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  signal_type text NOT NULL DEFAULT 'auto_tune',
  signal jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_signals_ts ON public.ops_runtime_signals(ts DESC);

ALTER TABLE public.jobtype_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_runtime_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srv_jobtype_limits" ON public.jobtype_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srv_ops_signals" ON public.ops_runtime_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- PART 3: Release C tables
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.quality_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text UNIQUE NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_rules_sev CHECK (severity IN ('warn', 'block'))
);
INSERT INTO public.quality_rules (rule_key, severity, config) VALUES
  ('blueprint_coverage', 'block', '{"min_percent": 95}'),
  ('lf_coverage', 'block', '{"min_percent": 90}'),
  ('duplicate_rate', 'block', '{"max_percent": 3}'),
  ('min_question_count', 'block', '{"min": 500}'),
  ('difficulty_distribution', 'warn', '{"easy_max_pct": 40, "hard_min_pct": 15}'),
  ('minicheck_present', 'warn', '{"required_step": 5}'),
  ('exam_relevance_score', 'warn', '{"min_score": 0.7}')
ON CONFLICT (rule_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.package_quality_reports (
  package_id uuid PRIMARY KEY,
  report jsonb NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  rules_passed int NOT NULL DEFAULT 0,
  rules_failed int NOT NULL DEFAULT 0,
  rules_warned int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pqr_status_chk CHECK (status IN ('pass', 'warn', 'fail', 'pending'))
);

ALTER TABLE public.quality_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_quality_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srv_quality_rules" ON public.quality_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srv_pqr" ON public.package_quality_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- PART 4: Release D - LLM cost events + adapt existing revenue_events
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.llm_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  certification_id uuid, course_id uuid, package_id uuid,
  job_type text, provider text, model text,
  tokens_in int DEFAULT 0, tokens_out int DEFAULT 0,
  cost_eur numeric DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_llm_cost_cert ON public.llm_cost_events(certification_id);
CREATE INDEX IF NOT EXISTS idx_llm_cost_ts ON public.llm_cost_events(ts DESC);

ALTER TABLE public.llm_cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srv_llm_cost" ON public.llm_cost_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add certification_id to existing revenue_events if not present
ALTER TABLE public.revenue_events ADD COLUMN IF NOT EXISTS certification_id uuid;

-- ROI view using existing revenue_events schema
CREATE OR REPLACE VIEW public.v_roi_certification AS
SELECT
  coalesce(lc.certification_id, re.certification_id) AS certification_id,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type IN ('purchase','renewal')), 0) AS revenue_eur,
  coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'refund'), 0) AS refunds_eur,
  coalesce(sum(lc.cost_eur), 0) AS llm_cost_eur,
  coalesce(sum(lc.tokens_in) + sum(lc.tokens_out), 0) AS total_tokens,
  (coalesce(sum(re.amount) FILTER (WHERE re.event_type IN ('purchase','renewal')), 0)
   - coalesce(sum(re.amount) FILTER (WHERE re.event_type = 'refund'), 0)
   - coalesce(sum(lc.cost_eur), 0)) AS net_profit_eur,
  count(DISTINCT re.id) FILTER (WHERE re.event_type = 'purchase') AS total_orders
FROM public.llm_cost_events lc
FULL OUTER JOIN public.revenue_events re ON lc.certification_id = re.certification_id
WHERE coalesce(lc.certification_id, re.certification_id) IS NOT NULL
GROUP BY 1;
