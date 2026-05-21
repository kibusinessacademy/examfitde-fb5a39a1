
CREATE TABLE IF NOT EXISTS public.intervention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL,
  intervention_type text NOT NULL,
  persona text NOT NULL DEFAULT 'all',
  risk_bucket text NOT NULL DEFAULT 'all',
  reason_code text NOT NULL DEFAULT 'all',
  base_weight numeric NOT NULL DEFAULT 1.0,
  current_weight numeric NOT NULL DEFAULT 1.0,
  threshold_score numeric NOT NULL DEFAULT 0.5,
  priority int NOT NULL DEFAULT 50,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  last_adjusted_at timestamptz,
  last_sample_size int NOT NULL DEFAULT 0,
  last_lift_pp numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intervention_policies_policy_key_uk UNIQUE (policy_key)
);

CREATE INDEX IF NOT EXISTS idx_intervention_policies_type_persona_risk
  ON public.intervention_policies (intervention_type, persona, risk_bucket);

ALTER TABLE public.intervention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ip_admin_read" ON public.intervention_policies FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "ip_service_write" ON public.intervention_policies TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.v_recommendation_policy_effectiveness AS
SELECT
  COALESCE(ur.recommendation_type, 'unknown') AS recommendation_type,
  COALESCE(ur.reason_code, 'unknown')         AS reason_code,
  COUNT(*) AS outcomes_total,
  COUNT(*) FILTER (WHERE ro.outcome_kind IN ('mastered','helpful','practiced'))  AS positive_count,
  COUNT(*) FILTER (WHERE ro.outcome_kind IN ('dismissed','irrelevant','not_helpful')) AS negative_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ro.outcome_kind IN ('mastered','helpful','practiced'))
        / NULLIF(COUNT(*),0), 2) AS positive_rate_pct,
  ROUND(AVG(ro.mastery_delta)::numeric, 4) AS avg_mastery_delta,
  COUNT(DISTINCT ro.user_id) AS distinct_users,
  MAX(ro.recorded_at) AS last_recorded_at
FROM public.recommendation_outcomes ro
JOIN public.user_recommendations ur ON ur.id = ro.recommendation_id
WHERE ro.recorded_at > now() - interval '90 days'
GROUP BY 1,2;

REVOKE ALL ON public.v_recommendation_policy_effectiveness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_recommendation_policy_effectiveness TO service_role;

CREATE OR REPLACE FUNCTION public.fn_adjust_intervention_policy_weights(
  p_alpha numeric DEFAULT 0.30, p_min_sample int DEFAULT 10
)
RETURNS TABLE(out_policy_key text, prev_weight numeric, new_weight numeric, sample_size int, positive_rate_pct numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row record; v_new_weight numeric; v_target numeric; v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT ip.policy_key, ip.current_weight, eff.outcomes_total, eff.positive_rate_pct, eff.avg_mastery_delta
    FROM public.intervention_policies ip
    JOIN public.v_recommendation_policy_effectiveness eff
      ON eff.recommendation_type = ip.intervention_type AND eff.reason_code = ip.reason_code
    WHERE ip.enabled = true AND eff.outcomes_total >= p_min_sample
  LOOP
    v_target := GREATEST(0.25, LEAST(2.0,
      (v_row.positive_rate_pct / 50.0) + GREATEST(0, COALESCE(v_row.avg_mastery_delta,0)) * 2.0));
    v_new_weight := ROUND(((1 - p_alpha) * v_row.current_weight + p_alpha * v_target)::numeric, 4);
    UPDATE public.intervention_policies
       SET current_weight = v_new_weight, last_adjusted_at = now(),
           last_sample_size = v_row.outcomes_total,
           last_lift_pp = v_row.positive_rate_pct - 50.0, updated_at = now()
     WHERE policy_key = v_row.policy_key;
    out_policy_key := v_row.policy_key; prev_weight := v_row.current_weight;
    new_weight := v_new_weight; sample_size := v_row.outcomes_total;
    positive_rate_pct := v_row.positive_rate_pct; v_count := v_count + 1;
    RETURN NEXT;
  END LOOP;
  PERFORM public.fn_emit_audit(
    _action_type := 'intervention_policy_weight_adjusted',
    _payload := jsonb_build_object('adjusted_count', v_count, 'alpha', p_alpha, 'min_sample', p_min_sample));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_adjust_intervention_policy_weights(numeric,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_adjust_intervention_policy_weights(numeric,int) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_intervention_policies()
RETURNS TABLE(policy_key text, intervention_type text, persona text, risk_bucket text,
  reason_code text, base_weight numeric, current_weight numeric, threshold_score numeric,
  priority int, enabled boolean, last_sample_size int, last_lift_pp numeric, last_adjusted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT policy_key, intervention_type, persona, risk_bucket, reason_code,
         base_weight, current_weight, threshold_score, priority, enabled,
         last_sample_size, last_lift_pp, last_adjusted_at
  FROM public.intervention_policies
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY priority DESC, current_weight DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_get_intervention_policies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_intervention_policies() TO authenticated;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES ('intervention_policy_weight_adjusted', ARRAY['adjusted_count','alpha','min_sample'], 'intervention_intelligence')
ON CONFLICT (action_type) DO NOTHING;

INSERT INTO public.intervention_policies (policy_key, intervention_type, reason_code, notes)
SELECT DISTINCT
  COALESCE(recommendation_type,'unknown') || '|' || COALESCE(reason_code,'unknown'),
  COALESCE(recommendation_type,'unknown'),
  COALESCE(reason_code,'unknown'),
  'auto-seeded from user_recommendations'
FROM public.user_recommendations
ON CONFLICT (policy_key) DO NOTHING;

SELECT public.fn_emit_audit(
  _action_type := 'intervention_policy_weight_adjusted',
  _payload := jsonb_build_object('adjusted_count', 0, 'alpha', 0.30, 'min_sample', 10, 'phase','baseline_seed'));
