
ALTER TABLE public.agent_outcome_bundles
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_tier TEXT NOT NULL DEFAULT 'MEDIUM'
    CHECK (risk_tier IN ('LOW','MEDIUM','HIGH'));

CREATE INDEX IF NOT EXISTS idx_aob_is_demo ON public.agent_outcome_bundles(is_demo) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_aob_risk_tier ON public.agent_outcome_bundles(risk_tier);

CREATE OR REPLACE FUNCTION public.fn_compute_bundle_risk_tier(
  _completeness NUMERIC, _confidence NUMERIC, _risk_register JSONB, _vertical_key TEXT
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_score NUMERIC := 0;
  v_risk_count INT := 0;
  v_high_risk_count INT := 0;
  v_industry_risk_level TEXT;
BEGIN
  v_risk_count := COALESCE(jsonb_array_length(COALESCE(_risk_register,'[]'::jsonb)), 0);
  SELECT COUNT(*) INTO v_high_risk_count
  FROM jsonb_array_elements(COALESCE(_risk_register,'[]'::jsonb)) AS r
  WHERE LOWER(COALESCE(r->>'severity', r->>'level','')) IN ('high','critical','hoch','kritisch');
  SELECT COALESCE(regulatory_context->>'risk_level','medium') INTO v_industry_risk_level
    FROM public.vertical_dna WHERE industry_key = _vertical_key;
  IF COALESCE(_completeness, 0) < 60 THEN v_score := v_score + 2;
  ELSIF COALESCE(_completeness, 0) < 80 THEN v_score := v_score + 1; END IF;
  IF COALESCE(_confidence, 1) < 0.6 THEN v_score := v_score + 2;
  ELSIF COALESCE(_confidence, 1) < 0.75 THEN v_score := v_score + 1; END IF;
  v_score := v_score + LEAST(v_high_risk_count, 3);
  IF v_risk_count >= 5 THEN v_score := v_score + 1; END IF;
  IF LOWER(COALESCE(v_industry_risk_level,'medium')) IN ('high','kritisch','critical') THEN
    v_score := v_score + 1;
  END IF;
  IF v_score >= 4 THEN RETURN 'HIGH';
  ELSIF v_score >= 2 THEN RETURN 'MEDIUM';
  ELSE RETURN 'LOW'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_bundle_risk_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.risk_tier := public.fn_compute_bundle_risk_tier(
    NEW.completeness_pct, NEW.confidence, NEW.risk_register, NEW.vertical_key);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aob_risk_tier ON public.agent_outcome_bundles;
CREATE TRIGGER trg_aob_risk_tier
  BEFORE INSERT OR UPDATE OF completeness_pct, confidence, risk_register, vertical_key
  ON public.agent_outcome_bundles
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_bundle_risk_tier();

UPDATE public.agent_outcome_bundles
SET risk_tier = public.fn_compute_bundle_risk_tier(completeness_pct, confidence, risk_register, vertical_key)
WHERE risk_tier = 'MEDIUM';

DROP VIEW IF EXISTS public.v_agent_vertical_coverage;
CREATE VIEW public.v_agent_vertical_coverage AS
SELECT
  agent_slug,
  vertical_key,
  COUNT(*)::int AS bundle_count,
  ROUND(AVG(completeness_pct)::numeric, 1) AS avg_completeness,
  MAX(created_at) AS last_run_at,
  SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END)::int AS approved_count,
  SUM(CASE WHEN risk_tier = 'HIGH' THEN 1 ELSE 0 END)::int AS high_risk_count
FROM (
  SELECT UNNEST(agent_team) AS agent_slug, vertical_key, completeness_pct, review_status, risk_tier, created_at
  FROM public.agent_outcome_bundles
) t
GROUP BY agent_slug, vertical_key;

REVOKE ALL ON public.v_agent_vertical_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_agent_vertical_coverage TO service_role;

DROP VIEW IF EXISTS public.v_bundle_kpi_impact_normalized;
CREATE VIEW public.v_bundle_kpi_impact_normalized AS
SELECT
  b.id AS bundle_id,
  b.vertical_key,
  (m.value->>'metric')::text AS metric_name,
  (m.value->>'unit')::text AS unit,
  NULLIF(m.value->>'baseline','')::numeric AS baseline,
  NULLIF(m.value->>'target','')::numeric AS target,
  CASE WHEN NULLIF(m.value->>'baseline','')::numeric IS NOT NULL
         AND NULLIF(m.value->>'target','')::numeric IS NOT NULL
       THEN NULLIF(m.value->>'target','')::numeric - NULLIF(m.value->>'baseline','')::numeric END AS delta,
  CASE WHEN NULLIF(m.value->>'baseline','')::numeric IS NOT NULL
         AND NULLIF(m.value->>'baseline','')::numeric <> 0
         AND NULLIF(m.value->>'target','')::numeric IS NOT NULL
       THEN ROUND(((NULLIF(m.value->>'target','')::numeric - NULLIF(m.value->>'baseline','')::numeric)
                / NULLIF(m.value->>'baseline','')::numeric * 100)::numeric, 1) END AS delta_pct,
  NULLIF(m.value->>'confidence','')::numeric AS confidence,
  (m.value->>'horizon')::text AS horizon,
  m.ordinality AS sort_order
FROM public.agent_outcome_bundles b
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(b.kpi_impact) = 'array' THEN b.kpi_impact ELSE '[]'::jsonb END
) WITH ORDINALITY AS m(value, ordinality);

REVOKE ALL ON public.v_bundle_kpi_impact_normalized FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_bundle_kpi_impact_normalized TO service_role;

DROP VIEW IF EXISTS public.v_bundle_decision_history;
CREATE VIEW public.v_bundle_decision_history AS
SELECT
  (metadata->>'bundle_id')::uuid AS bundle_id,
  action_type,
  REPLACE(action_type, 'outcome_bundle_', '') AS decision,
  NULLIF(metadata->>'actor','')::uuid AS actor_id,
  metadata->>'reason' AS reason,
  result_status,
  created_at
FROM public.auto_heal_log
WHERE action_type IN (
  'outcome_bundle_created','outcome_bundle_in_review','outcome_bundle_approve',
  'outcome_bundle_reject','outcome_bundle_apply','outcome_bundle_rollback','outcome_bundle_exported'
) AND metadata ? 'bundle_id';

REVOKE ALL ON public.v_bundle_decision_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_bundle_decision_history TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_agent_vertical_matrix()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: admin role required' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'agents', (SELECT jsonb_agg(jsonb_build_object('slug',slug,'name',name,'category',category) ORDER BY slug)
               FROM public.berufs_ki_agents WHERE is_active=true AND slug LIKE 'outcome-%'),
    'verticals', (SELECT jsonb_agg(jsonb_build_object('industry_key',industry_key,'name',name) ORDER BY industry_key)
                  FROM public.vertical_dna WHERE is_active=true),
    'cells', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.v_agent_vertical_coverage c), '[]'::jsonb),
    'generated_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_agent_vertical_matrix() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_agent_vertical_matrix() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_bundle_kpi_impact(_bundle_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_vertical TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: admin role required' USING ERRCODE='42501';
  END IF;
  SELECT vertical_key INTO v_vertical FROM public.agent_outcome_bundles WHERE id=_bundle_id;
  IF v_vertical IS NULL THEN
    RETURN jsonb_build_object('bundle_id',_bundle_id,'metrics','[]'::jsonb,'benchmarks','[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'bundle_id', _bundle_id,
    'vertical_key', v_vertical,
    'metrics', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.sort_order)
                         FROM public.v_bundle_kpi_impact_normalized m WHERE m.bundle_id=_bundle_id), '[]'::jsonb),
    'benchmarks', COALESCE((SELECT kpis FROM public.vertical_dna WHERE industry_key=v_vertical), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_bundle_kpi_impact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bundle_kpi_impact(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_bundle_decision_history(_bundle_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: admin role required' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at ASC)
    FROM public.v_bundle_decision_history h WHERE h.bundle_id=_bundle_id
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_bundle_decision_history(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bundle_decision_history(UUID) TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('outcome_bundle_exported', ARRAY['bundle_id','format','exported_by','byte_size'], 'berufs_ki'),
  ('demo_bundle_seeded', ARRAY['bundle_id','vertical_key'], 'berufs_ki')
ON CONFLICT (action_type) DO NOTHING;
