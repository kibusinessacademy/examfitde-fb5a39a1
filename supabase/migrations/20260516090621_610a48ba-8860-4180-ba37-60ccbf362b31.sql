
CREATE TABLE IF NOT EXISTS public.nba_weighting_rules (
  intervention_type        text PRIMARY KEY,
  min_sample_for_weighting int  NOT NULL DEFAULT 15,
  min_lift_pp_prefer       numeric NOT NULL DEFAULT 2,
  block_lift_pp            numeric NOT NULL DEFAULT -5,
  safety_fallback          boolean NOT NULL DEFAULT false,
  weight_boost_pp_per_lift numeric NOT NULL DEFAULT 1.0,
  notes                    text,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nba_weighting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nbar_admin_read" ON public.nba_weighting_rules
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "nbar_service_write" ON public.nba_weighting_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.nba_weighting_rules (intervention_type, safety_fallback, notes) VALUES
  ('rescue_session',        true,  'AT_RISK/CRITICAL safety: never block'),
  ('exam_simulation',       true,  'Diagnostic value irrespective of lift'),
  ('final_exam_prep',       true,  'Pre-exam pressure: never block'),
  ('lf_gap_drill',          false, 'LF-targeted gap drill'),
  ('weakness_training',     false, 'Competency-targeted'),
  ('retention_nudge',       false, 'Lift-sensitive; downrank if negative'),
  ('winback_campaign',      false, 'Lift-sensitive'),
  ('activate_account',      true,  'Activation path: never block'),
  ('maintain_streak',       false, 'Engagement nudge'),
  ('continue_learning',     false, 'Default flow')
ON CONFLICT (intervention_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_empirical_next_best_action AS
WITH base AS (
  SELECT
    nba.user_id,
    nba.curriculum_id,
    nba.nba_action,
    nba.retention_risk,
    nba.nba_priority                     AS rule_priority,
    nba.exam_success_probability_pct
  FROM public.v_next_best_action nba
), enriched AS (
  SELECT
    b.*,
    s.sample_size,
    s.pass_rate_lift_pp,
    s.confidence_label,
    COALESCE(r.min_sample_for_weighting, 15)  AS min_sample,
    COALESCE(r.min_lift_pp_prefer, 2)         AS min_lift_prefer,
    COALESCE(r.block_lift_pp, -5)             AS block_lift,
    COALESCE(r.safety_fallback, false)        AS safety_fallback,
    COALESCE(r.weight_boost_pp_per_lift, 1.0) AS weight_boost
  FROM base b
  LEFT JOIN public.intervention_effectiveness_scores s
    ON s.intervention_type = b.nba_action
   AND s.risk_bucket       = COALESCE(b.retention_risk, 'all')
   AND s.lf_code           = 'all'
  LEFT JOIN public.nba_weighting_rules r
    ON r.intervention_type = b.nba_action
)
SELECT
  user_id, curriculum_id, nba_action, retention_risk,
  rule_priority, exam_success_probability_pct,
  sample_size, pass_rate_lift_pp, confidence_label,
  CASE
    WHEN sample_size IS NULL OR sample_size < min_sample THEN 'neutral'
    WHEN pass_rate_lift_pp IS NOT NULL AND pass_rate_lift_pp <= block_lift
         AND NOT safety_fallback AND retention_risk NOT IN ('high','critical') THEN 'block'
    WHEN pass_rate_lift_pp IS NOT NULL AND pass_rate_lift_pp <= block_lift
         AND (safety_fallback OR retention_risk IN ('high','critical')) THEN 'safety_fallback'
    WHEN pass_rate_lift_pp IS NOT NULL AND pass_rate_lift_pp >= min_lift_prefer THEN 'prefer'
    WHEN pass_rate_lift_pp IS NOT NULL AND pass_rate_lift_pp < 0 THEN 'downrank'
    ELSE 'neutral'
  END AS decision,
  CASE
    WHEN sample_size IS NOT NULL AND sample_size >= min_sample AND pass_rate_lift_pp IS NOT NULL
      THEN GREATEST(0, LEAST(100, rule_priority + ROUND(pass_rate_lift_pp * weight_boost)::int))
    ELSE rule_priority
  END AS empirical_priority
FROM enriched;

REVOKE ALL ON public.v_empirical_next_best_action FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_empirical_next_best_action TO service_role;

CREATE OR REPLACE FUNCTION public.fn_compute_empirical_nba(p_user_id uuid, p_curriculum_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM public.v_empirical_next_best_action
   WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_nba_row'); END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, details)
  VALUES ('empirical_nba_reweighted', 'learner', p_user_id::text, 'success',
    jsonb_build_object(
      'user_id', p_user_id, 'curriculum_id', p_curriculum_id,
      'nba_action', v_row.nba_action, 'retention_risk', v_row.retention_risk,
      'rule_priority', v_row.rule_priority, 'empirical_priority', v_row.empirical_priority,
      'pass_rate_lift_pp', v_row.pass_rate_lift_pp, 'sample_size', v_row.sample_size,
      'confidence_label', v_row.confidence_label, 'decision', v_row.decision
    ));

  RETURN jsonb_build_object(
    'ok', true, 'nba_action', v_row.nba_action, 'retention_risk', v_row.retention_risk,
    'rule_priority', v_row.rule_priority, 'empirical_priority', v_row.empirical_priority,
    'pass_rate_lift_pp', v_row.pass_rate_lift_pp, 'confidence_label', v_row.confidence_label,
    'decision', v_row.decision
  );
END; $$;
REVOKE ALL ON FUNCTION public.fn_compute_empirical_nba(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_empirical_nba(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_nba_weighting_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_decisions jsonb; v_actions jsonb; v_recent jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_object_agg(decision, n) INTO v_decisions
    FROM (SELECT decision, COUNT(*)::int AS n FROM public.v_empirical_next_best_action GROUP BY 1) s;

  SELECT jsonb_agg(jsonb_build_object(
           'nba_action', nba_action, 'decision', decision, 'n', n,
           'avg_lift_pp', avg_lift, 'avg_priority_shift', shift) ORDER BY n DESC)
    INTO v_actions
    FROM (
      SELECT nba_action, decision, COUNT(*)::int AS n,
             ROUND(AVG(pass_rate_lift_pp)::numeric, 1) AS avg_lift,
             ROUND(AVG(empirical_priority - rule_priority)::numeric, 1) AS shift
        FROM public.v_empirical_next_best_action GROUP BY 1,2
    ) s;

  SELECT jsonb_agg(jsonb_build_object('at', created_at, 'details', details) ORDER BY created_at DESC)
    INTO v_recent
    FROM (
      SELECT created_at, details FROM public.auto_heal_log
       WHERE action_type = 'empirical_nba_reweighted'
       ORDER BY created_at DESC LIMIT 20
    ) s;

  RETURN jsonb_build_object(
    'decisions_count', COALESCE(v_decisions, '{}'::jsonb),
    'per_action',      COALESCE(v_actions,   '[]'::jsonb),
    'recent_audit',    COALESCE(v_recent,    '[]'::jsonb)
  );
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_nba_weighting_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_nba_weighting_health() TO authenticated;
