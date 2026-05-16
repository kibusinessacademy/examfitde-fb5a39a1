
-- ─────────────────────────────────────────────────────────────
-- Bridge 6: Adaptive Intervention Effectiveness Engine
-- ─────────────────────────────────────────────────────────────

-- 1) Event ledger: every intervention dispatched + outcome window
CREATE TABLE IF NOT EXISTS public.learner_intervention_events (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL,
  curriculum_id               uuid,
  intervention_type           text NOT NULL,         -- e.g. 'rescue_session','exam_simulation','retention_nudge'
  intervention_source         text,                  -- 'nba','manual','tutor','rescue'
  risk_bucket                 text,                  -- 'low'|'medium'|'high'|'critical'
  lf_code                     text,                  -- learning field if scoped
  competency_id               uuid,
  readiness_before            numeric,
  readiness_after             numeric,
  readiness_delta             numeric GENERATED ALWAYS AS (COALESCE(readiness_after,0) - COALESCE(readiness_before,0)) STORED,
  exam_outcome                text,                  -- 'pass'|'fail'|'partial'|null (no exam yet)
  days_to_exam_at_dispatch    int,
  dispatched_at               timestamptz NOT NULL DEFAULT now(),
  measured_at                 timestamptz,
  meta                        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_lie_user      ON public.learner_intervention_events(user_id);
CREATE INDEX IF NOT EXISTS idx_lie_curr      ON public.learner_intervention_events(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_lie_type_risk ON public.learner_intervention_events(intervention_type, risk_bucket);
CREATE INDEX IF NOT EXISTS idx_lie_dispatched ON public.learner_intervention_events(dispatched_at DESC);

ALTER TABLE public.learner_intervention_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lie_self_read" ON public.learner_intervention_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "lie_admin_read" ON public.learner_intervention_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "lie_service_write" ON public.learner_intervention_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Aggregated effectiveness scores per (type, risk, lf)
CREATE TABLE IF NOT EXISTS public.intervention_effectiveness_scores (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_type        text NOT NULL,
  risk_bucket              text NOT NULL DEFAULT 'all',
  lf_code                  text NOT NULL DEFAULT 'all',
  sample_size              int NOT NULL DEFAULT 0,
  avg_readiness_delta      numeric,
  pass_rate_pct            numeric,
  baseline_pass_rate_pct   numeric,
  pass_rate_lift_pp        numeric,   -- percentage-points lift vs baseline
  confidence_label         text,      -- 'low'|'medium'|'high' (heuristic on n)
  computed_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intervention_type, risk_bucket, lf_code)
);
ALTER TABLE public.intervention_effectiveness_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ies_admin_read" ON public.intervention_effectiveness_scores
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "ies_service_write" ON public.intervention_effectiveness_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) Recovery paths: ordered sequences of interventions from at-risk → ready
CREATE TABLE IF NOT EXISTS public.learner_recovery_paths (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL,
  curriculum_id            uuid,
  started_at               timestamptz NOT NULL,
  completed_at             timestamptz,
  start_risk_bucket        text,
  end_readiness_verdict    text,
  intervention_sequence    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{type, dispatched_at, delta}, ...]
  total_interventions      int NOT NULL DEFAULT 0,
  total_readiness_gain     numeric,
  outcome                  text,                                 -- 'recovered'|'partial'|'failed'|'in_progress'
  meta                     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_lrp_user ON public.learner_recovery_paths(user_id);
CREATE INDEX IF NOT EXISTS idx_lrp_outcome ON public.learner_recovery_paths(outcome);
ALTER TABLE public.learner_recovery_paths ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lrp_self_read" ON public.learner_recovery_paths
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "lrp_admin_read" ON public.learner_recovery_paths
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "lrp_service_write" ON public.learner_recovery_paths
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4) Mirror trigger: learner_intervention_dispatch_log → learner_intervention_events
CREATE OR REPLACE FUNCTION public.fn_mirror_dispatch_to_intervention_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_risk text;
  v_readiness numeric;
BEGIN
  SELECT retention_risk INTO v_risk
    FROM public.learner_intervention_state
   WHERE user_id = NEW.user_id
     AND curriculum_id = NEW.curriculum_id
   LIMIT 1;

  SELECT readiness_score INTO v_readiness
    FROM public.learner_readiness_history
   WHERE user_id = NEW.user_id
     AND curriculum_id = NEW.curriculum_id
   ORDER BY measured_at DESC NULLS LAST
   LIMIT 1;

  INSERT INTO public.learner_intervention_events (
    user_id, curriculum_id, intervention_type, intervention_source,
    risk_bucket, readiness_before, dispatched_at, meta
  ) VALUES (
    NEW.user_id, NEW.curriculum_id, COALESCE(NEW.nba_action, NEW.action_type, 'unknown'),
    COALESCE(NEW.source, 'nba'),
    v_risk, v_readiness, COALESCE(NEW.dispatched_at, now()),
    COALESCE(NEW.meta, '{}'::jsonb)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block the dispatch insert
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='learner_intervention_dispatch_log') THEN
    DROP TRIGGER IF EXISTS trg_mirror_dispatch_to_events ON public.learner_intervention_dispatch_log;
    CREATE TRIGGER trg_mirror_dispatch_to_events
      AFTER INSERT ON public.learner_intervention_dispatch_log
      FOR EACH ROW EXECUTE FUNCTION public.fn_mirror_dispatch_to_intervention_events();
  END IF;
END$$;

-- 5) Views (service_role only)
CREATE OR REPLACE VIEW public.v_intervention_effectiveness AS
SELECT
  intervention_type,
  COALESCE(risk_bucket, 'unknown') AS risk_bucket,
  COUNT(*)::int                                   AS sample_size,
  ROUND(AVG(readiness_delta)::numeric, 2)         AS avg_readiness_delta,
  ROUND(
    100.0 * SUM(CASE WHEN exam_outcome='pass' THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(CASE WHEN exam_outcome IN ('pass','fail') THEN 1 ELSE 0 END),0)
  , 1) AS pass_rate_pct,
  COUNT(*) FILTER (WHERE exam_outcome IS NULL)::int AS pending_outcome
FROM public.learner_intervention_events
GROUP BY 1,2;

REVOKE ALL ON public.v_intervention_effectiveness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_intervention_effectiveness TO service_role;

CREATE OR REPLACE VIEW public.v_best_recovery_actions AS
WITH base AS (
  SELECT intervention_type, risk_bucket,
         AVG(readiness_delta) AS avg_delta,
         COUNT(*) AS n
  FROM public.learner_intervention_events
  WHERE readiness_after IS NOT NULL
  GROUP BY 1,2
)
SELECT * FROM base WHERE n >= 5 ORDER BY avg_delta DESC NULLS LAST;
REVOKE ALL ON public.v_best_recovery_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_best_recovery_actions TO service_role;

CREATE OR REPLACE VIEW public.v_intervention_failure_patterns AS
SELECT intervention_type, risk_bucket,
       COUNT(*) FILTER (WHERE exam_outcome='fail')::int AS failures,
       COUNT(*)::int AS total,
       ROUND(100.0 * COUNT(*) FILTER (WHERE exam_outcome='fail')::numeric / NULLIF(COUNT(*),0), 1) AS fail_rate_pct
FROM public.learner_intervention_events
GROUP BY 1,2
HAVING COUNT(*) >= 5
ORDER BY fail_rate_pct DESC NULLS LAST;
REVOKE ALL ON public.v_intervention_failure_patterns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_intervention_failure_patterns TO service_role;

-- 6) Recompute aggregated effectiveness scores (idempotent UPSERT)
CREATE OR REPLACE FUNCTION public.fn_recompute_intervention_effectiveness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_baseline numeric;
  v_upserted int := 0;
BEGIN
  SELECT ROUND(100.0 * SUM(CASE WHEN exam_outcome='pass' THEN 1 ELSE 0 END)::numeric
               / NULLIF(SUM(CASE WHEN exam_outcome IN ('pass','fail') THEN 1 ELSE 0 END),0), 1)
    INTO v_baseline
    FROM public.learner_intervention_events;

  WITH agg AS (
    SELECT
      intervention_type,
      COALESCE(risk_bucket,'all') AS risk_bucket,
      COALESCE(lf_code,'all')     AS lf_code,
      COUNT(*)                    AS n,
      ROUND(AVG(readiness_delta)::numeric, 2) AS avg_delta,
      ROUND(100.0 * SUM(CASE WHEN exam_outcome='pass' THEN 1 ELSE 0 END)::numeric
            / NULLIF(SUM(CASE WHEN exam_outcome IN ('pass','fail') THEN 1 ELSE 0 END),0), 1) AS pr
    FROM public.learner_intervention_events
    GROUP BY 1,2,3
  )
  INSERT INTO public.intervention_effectiveness_scores
    (intervention_type, risk_bucket, lf_code, sample_size, avg_readiness_delta,
     pass_rate_pct, baseline_pass_rate_pct, pass_rate_lift_pp, confidence_label, computed_at)
  SELECT
    intervention_type, risk_bucket, lf_code, n, avg_delta,
    pr, v_baseline,
    CASE WHEN pr IS NULL OR v_baseline IS NULL THEN NULL ELSE pr - v_baseline END,
    CASE WHEN n >= 50 THEN 'high' WHEN n >= 15 THEN 'medium' ELSE 'low' END,
    now()
  FROM agg
  ON CONFLICT (intervention_type, risk_bucket, lf_code) DO UPDATE
  SET sample_size           = EXCLUDED.sample_size,
      avg_readiness_delta   = EXCLUDED.avg_readiness_delta,
      pass_rate_pct         = EXCLUDED.pass_rate_pct,
      baseline_pass_rate_pct= EXCLUDED.baseline_pass_rate_pct,
      pass_rate_lift_pp     = EXCLUDED.pass_rate_lift_pp,
      confidence_label      = EXCLUDED.confidence_label,
      computed_at           = now();

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  INSERT INTO public.auto_heal_log (action_type, result_status, details)
  VALUES ('intervention_effectiveness_recompute', 'success',
          jsonb_build_object('upserted', v_upserted, 'baseline_pass_rate_pct', v_baseline));

  RETURN jsonb_build_object('ok', true, 'upserted', v_upserted, 'baseline', v_baseline);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recompute_intervention_effectiveness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recompute_intervention_effectiveness() TO service_role;

-- 7) Admin RPC for cockpit
CREATE OR REPLACE FUNCTION public.admin_get_intervention_effectiveness()
RETURNS TABLE (
  intervention_type      text,
  risk_bucket            text,
  lf_code                text,
  sample_size            int,
  avg_readiness_delta    numeric,
  pass_rate_pct          numeric,
  baseline_pass_rate_pct numeric,
  pass_rate_lift_pp      numeric,
  confidence_label       text,
  computed_at            timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT s.intervention_type, s.risk_bucket, s.lf_code, s.sample_size,
           s.avg_readiness_delta, s.pass_rate_pct, s.baseline_pass_rate_pct,
           s.pass_rate_lift_pp, s.confidence_label, s.computed_at
      FROM public.intervention_effectiveness_scores s
     ORDER BY s.pass_rate_lift_pp DESC NULLS LAST, s.sample_size DESC
     LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_intervention_effectiveness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_intervention_effectiveness() TO authenticated;
