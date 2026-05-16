
-- ============================================================
-- Bridge 9 — Cohort & Population Intelligence
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cohort_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_key text NOT NULL,
  cohort_type text NOT NULL CHECK (cohort_type IN ('organization','curriculum','lf_code','region','exam_window','custom')),
  curriculum_id uuid NULL,
  organization_id uuid NULL,
  lf_code text NULL,
  snapshot_date date NOT NULL DEFAULT current_date,
  learner_count int NOT NULL DEFAULT 0,
  avg_readiness numeric(6,2) NULL,
  pct_at_risk numeric(6,2) NULL,
  pct_ready numeric(6,2) NULL,
  pass_rate numeric(6,2) NULL,
  fail_rate numeric(6,2) NULL,
  active_learners int NOT NULL DEFAULT 0,
  inactive_learners int NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_type, cohort_key, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_cohort_snapshots_type_date
  ON public.cohort_snapshots(cohort_type, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_cohort_snapshots_curriculum
  ON public.cohort_snapshots(curriculum_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_cohort_snapshots_organization
  ON public.cohort_snapshots(organization_id, snapshot_date DESC);

ALTER TABLE public.cohort_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read cohort_snapshots" ON public.cohort_snapshots;
CREATE POLICY "admin read cohort_snapshots" ON public.cohort_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "service_role write cohort_snapshots" ON public.cohort_snapshots;
CREATE POLICY "service_role write cohort_snapshots" ON public.cohort_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.population_risk_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key text NOT NULL UNIQUE,
  cluster_label text NOT NULL,
  curriculum_id uuid NULL,
  lf_code text NULL,
  risk_bucket text NOT NULL CHECK (risk_bucket IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  learner_count int NOT NULL DEFAULT 0,
  avg_readiness numeric(6,2) NULL,
  pass_rate numeric(6,2) NULL,
  fail_rate numeric(6,2) NULL,
  top_failure_drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_effective_interventions jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_size int NOT NULL DEFAULT 0,
  confidence_label text NOT NULL DEFAULT 'low' CHECK (confidence_label IN ('low','medium','high')),
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.population_risk_clusters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read population_risk_clusters" ON public.population_risk_clusters;
CREATE POLICY "admin read population_risk_clusters" ON public.population_risk_clusters
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "service_role write population_risk_clusters" ON public.population_risk_clusters;
CREATE POLICY "service_role write population_risk_clusters" ON public.population_risk_clusters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.organization_learning_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  curriculum_id uuid NULL,
  snapshot_date date NOT NULL DEFAULT current_date,
  total_learners int NOT NULL DEFAULT 0,
  active_learners int NOT NULL DEFAULT 0,
  avg_readiness numeric(6,2) NULL,
  pct_at_risk numeric(6,2) NULL,
  pct_ready numeric(6,2) NULL,
  pass_rate numeric(6,2) NULL,
  intervention_effectiveness_avg_pp numeric(6,2) NULL,
  quality_score numeric(6,2) NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_learning_health_with_curr
  ON public.organization_learning_health(organization_id, curriculum_id, snapshot_date)
  WHERE curriculum_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_learning_health_no_curr
  ON public.organization_learning_health(organization_id, snapshot_date)
  WHERE curriculum_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_learning_health_org_date
  ON public.organization_learning_health(organization_id, snapshot_date DESC);

ALTER TABLE public.organization_learning_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read org_learning_health" ON public.organization_learning_health;
CREATE POLICY "admin read org_learning_health" ON public.organization_learning_health
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "service_role write org_learning_health" ON public.organization_learning_health;
CREATE POLICY "service_role write org_learning_health" ON public.organization_learning_health
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------- VIEWS ----------

CREATE OR REPLACE VIEW public.v_cohort_readiness_distribution AS
SELECT cs.cohort_type, cs.cohort_key, cs.curriculum_id, cs.organization_id, cs.lf_code,
       cs.snapshot_date, cs.learner_count, cs.avg_readiness, cs.pct_at_risk,
       cs.pct_ready, cs.pass_rate, cs.fail_rate, cs.active_learners, cs.inactive_learners
FROM public.cohort_snapshots cs
WHERE cs.snapshot_date >= current_date - interval '90 days';
REVOKE ALL ON public.v_cohort_readiness_distribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cohort_readiness_distribution TO service_role;

CREATE OR REPLACE VIEW public.v_population_failure_patterns AS
SELECT prc.cluster_key, prc.cluster_label, prc.curriculum_id, prc.lf_code,
       prc.risk_bucket, prc.learner_count, prc.avg_readiness, prc.fail_rate,
       prc.top_failure_drivers, prc.confidence_label, prc.sample_size, prc.last_computed_at
FROM public.population_risk_clusters prc
WHERE prc.risk_bucket IN ('HIGH','CRITICAL') OR prc.fail_rate >= 30;
REVOKE ALL ON public.v_population_failure_patterns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_population_failure_patterns TO service_role;

CREATE OR REPLACE VIEW public.v_org_intervention_effectiveness AS
SELECT olh.organization_id, olh.curriculum_id, olh.snapshot_date,
       olh.total_learners, olh.active_learners, olh.avg_readiness,
       olh.pct_at_risk, olh.pct_ready, olh.pass_rate,
       olh.intervention_effectiveness_avg_pp, olh.quality_score
FROM public.organization_learning_health olh
WHERE olh.snapshot_date >= current_date - interval '90 days';
REVOKE ALL ON public.v_org_intervention_effectiveness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_org_intervention_effectiveness TO service_role;

CREATE OR REPLACE VIEW public.v_exam_readiness_benchmarks AS
SELECT cs.curriculum_id, cs.snapshot_date,
       AVG(cs.avg_readiness)::numeric(6,2) AS benchmark_avg_readiness,
       AVG(cs.pass_rate)::numeric(6,2) AS benchmark_pass_rate,
       AVG(cs.pct_at_risk)::numeric(6,2) AS benchmark_pct_at_risk,
       SUM(cs.learner_count)::int AS total_learners,
       COUNT(*)::int AS cohort_count
FROM public.cohort_snapshots cs
WHERE cs.curriculum_id IS NOT NULL
  AND cs.snapshot_date >= current_date - interval '90 days'
GROUP BY cs.curriculum_id, cs.snapshot_date;
REVOKE ALL ON public.v_exam_readiness_benchmarks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_exam_readiness_benchmarks TO service_role;

-- ---------- ADMIN RPCs ----------

CREATE OR REPLACE FUNCTION public.admin_get_cohort_readiness_distribution(p_limit int DEFAULT 100)
RETURNS TABLE(cohort_type text, cohort_key text, curriculum_id uuid, organization_id uuid, lf_code text,
  snapshot_date date, learner_count int, avg_readiness numeric, pct_at_risk numeric,
  pct_ready numeric, pass_rate numeric, fail_rate numeric, active_learners int, inactive_learners int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  RETURN QUERY
    SELECT v.cohort_type, v.cohort_key, v.curriculum_id, v.organization_id, v.lf_code,
           v.snapshot_date, v.learner_count, v.avg_readiness, v.pct_at_risk,
           v.pct_ready, v.pass_rate, v.fail_rate, v.active_learners, v.inactive_learners
    FROM public.v_cohort_readiness_distribution v
    ORDER BY v.snapshot_date DESC, v.learner_count DESC NULLS LAST
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_population_failure_patterns(p_limit int DEFAULT 100)
RETURNS TABLE(cluster_key text, cluster_label text, curriculum_id uuid, lf_code text,
  risk_bucket text, learner_count int, avg_readiness numeric, fail_rate numeric,
  top_failure_drivers jsonb, confidence_label text, sample_size int, last_computed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  RETURN QUERY
    SELECT v.cluster_key, v.cluster_label, v.curriculum_id, v.lf_code,
           v.risk_bucket, v.learner_count, v.avg_readiness, v.fail_rate,
           v.top_failure_drivers, v.confidence_label, v.sample_size, v.last_computed_at
    FROM public.v_population_failure_patterns v
    ORDER BY v.fail_rate DESC NULLS LAST, v.learner_count DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_org_intervention_effectiveness(p_limit int DEFAULT 100)
RETURNS TABLE(organization_id uuid, curriculum_id uuid, snapshot_date date,
  total_learners int, active_learners int, avg_readiness numeric,
  pct_at_risk numeric, pct_ready numeric, pass_rate numeric,
  intervention_effectiveness_avg_pp numeric, quality_score numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  RETURN QUERY
    SELECT v.organization_id, v.curriculum_id, v.snapshot_date,
           v.total_learners, v.active_learners, v.avg_readiness,
           v.pct_at_risk, v.pct_ready, v.pass_rate,
           v.intervention_effectiveness_avg_pp, v.quality_score
    FROM public.v_org_intervention_effectiveness v
    ORDER BY v.snapshot_date DESC, v.quality_score DESC NULLS LAST
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_exam_readiness_benchmarks(p_limit int DEFAULT 100)
RETURNS TABLE(curriculum_id uuid, snapshot_date date,
  benchmark_avg_readiness numeric, benchmark_pass_rate numeric, benchmark_pct_at_risk numeric,
  total_learners int, cohort_count int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  RETURN QUERY
    SELECT v.curriculum_id, v.snapshot_date,
           v.benchmark_avg_readiness, v.benchmark_pass_rate, v.benchmark_pct_at_risk,
           v.total_learners, v.cohort_count
    FROM public.v_exam_readiness_benchmarks v
    ORDER BY v.snapshot_date DESC, v.total_learners DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END $$;

CREATE OR REPLACE FUNCTION public.fn_recompute_population_intelligence()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cohorts_written int := 0;
  v_clusters_written int := 0;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (lrh.user_id, lrh.curriculum_id)
      lrh.user_id, lrh.curriculum_id, lrh.readiness_score, lrh.verdict, lrh.recorded_at
    FROM public.learner_readiness_history lrh
    WHERE lrh.curriculum_id IS NOT NULL
    ORDER BY lrh.user_id, lrh.curriculum_id, lrh.recorded_at DESC
  ), agg AS (
    SELECT curriculum_id,
           COUNT(*)::int AS learner_count,
           AVG(readiness_score)::numeric(6,2) AS avg_readiness,
           (100.0 * SUM(CASE WHEN verdict IN ('at_risk','critical') THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0))::numeric(6,2) AS pct_at_risk,
           (100.0 * SUM(CASE WHEN verdict = 'ready' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0))::numeric(6,2) AS pct_ready
    FROM latest GROUP BY curriculum_id
  )
  INSERT INTO public.cohort_snapshots
    (cohort_key, cohort_type, curriculum_id, snapshot_date, learner_count, avg_readiness, pct_at_risk, pct_ready)
  SELECT 'curriculum:' || curriculum_id::text, 'curriculum', curriculum_id, current_date,
         learner_count, avg_readiness, pct_at_risk, pct_ready
  FROM agg
  ON CONFLICT (cohort_type, cohort_key, snapshot_date) DO UPDATE
    SET learner_count = EXCLUDED.learner_count,
        avg_readiness = EXCLUDED.avg_readiness,
        pct_at_risk   = EXCLUDED.pct_at_risk,
        pct_ready     = EXCLUDED.pct_ready;
  GET DIAGNOSTICS v_cohorts_written = ROW_COUNT;

  WITH base AS (
    SELECT 'curriculum:' || COALESCE(lf_code,'_all') || ':' || risk_bucket AS cluster_key,
           'LF ' || COALESCE(lf_code,'all') || ' / ' || risk_bucket AS cluster_label,
           lf_code, risk_bucket,
           SUM(sample_size)::int AS sample_size,
           AVG(pass_rate_lift_pp)::numeric(6,2) AS lift_pp,
           MAX(CASE WHEN sample_size >= 50 THEN 'high'
                    WHEN sample_size >= 15 THEN 'medium' ELSE 'low' END) AS conf
    FROM public.intervention_effectiveness_scores
    GROUP BY lf_code, risk_bucket
  )
  INSERT INTO public.population_risk_clusters
    (cluster_key, cluster_label, lf_code, risk_bucket, learner_count, fail_rate, confidence_label, sample_size, last_computed_at)
  SELECT cluster_key, cluster_label, lf_code,
         CASE WHEN risk_bucket IN ('LOW','MEDIUM','HIGH','CRITICAL') THEN risk_bucket ELSE 'MEDIUM' END,
         sample_size, GREATEST(0, -lift_pp)::numeric(6,2), conf, sample_size, now()
  FROM base
  ON CONFLICT (cluster_key) DO UPDATE
    SET learner_count = EXCLUDED.learner_count,
        fail_rate = EXCLUDED.fail_rate,
        confidence_label = EXCLUDED.confidence_label,
        sample_size = EXCLUDED.sample_size,
        last_computed_at = now();
  GET DIAGNOSTICS v_clusters_written = ROW_COUNT;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, details)
  VALUES ('population_intelligence_recompute','system','ok',
          jsonb_build_object('cohorts_written', v_cohorts_written, 'clusters_written', v_clusters_written));

  RETURN jsonb_build_object('cohorts_written', v_cohorts_written, 'clusters_written', v_clusters_written);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, details)
  VALUES ('population_intelligence_recompute','system','error', jsonb_build_object('error', SQLERRM));
  RAISE;
END $$;

REVOKE ALL ON FUNCTION public.fn_recompute_population_intelligence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recompute_population_intelligence() TO service_role;
