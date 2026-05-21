
-- 1) Outcome table — single source of truth for "did this recommendation help?"
CREATE TABLE IF NOT EXISTS public.recommendation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.user_recommendations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  curriculum_id uuid,
  outcome_kind text NOT NULL CHECK (outcome_kind IN ('practiced','mastered','dismissed','irrelevant','helpful','not_helpful')),
  mastery_before numeric,
  mastery_after numeric,
  mastery_delta numeric GENERATED ALWAYS AS (COALESCE(mastery_after,0) - COALESCE(mastery_before,0)) STORED,
  competency_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reco_outcomes_user_curriculum ON public.recommendation_outcomes(user_id, curriculum_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_reco_outcomes_recommendation ON public.recommendation_outcomes(recommendation_id);

ALTER TABLE public.recommendation_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own outcomes" ON public.recommendation_outcomes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admins read all outcomes" ON public.recommendation_outcomes FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
-- Writes go strictly through SECURITY DEFINER RPC (no direct INSERT policy)

-- 2) Single write path with ownership + recommendation validation
CREATE OR REPLACE FUNCTION public.learner_record_recommendation_outcome(
  p_recommendation_id uuid,
  p_outcome_kind text,
  p_mastery_before numeric DEFAULT NULL,
  p_mastery_after numeric DEFAULT NULL,
  p_competency_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reco_owner uuid;
  v_curriculum uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id, curriculum_id INTO v_reco_owner, v_curriculum FROM public.user_recommendations WHERE id = p_recommendation_id;
  IF v_reco_owner IS NULL THEN RAISE EXCEPTION 'recommendation not found'; END IF;
  IF v_reco_owner <> v_uid THEN RAISE EXCEPTION 'forbidden: not owner'; END IF;

  INSERT INTO public.recommendation_outcomes(
    recommendation_id, user_id, curriculum_id, outcome_kind,
    mastery_before, mastery_after, competency_id, details
  ) VALUES (
    p_recommendation_id, v_uid, v_curriculum, p_outcome_kind,
    p_mastery_before, p_mastery_after, p_competency_id, COALESCE(p_details,'{}'::jsonb)
  ) RETURNING id INTO v_id;

  -- Mark recommendation resolved on terminal outcomes
  IF p_outcome_kind IN ('mastered','dismissed','irrelevant') THEN
    UPDATE public.user_recommendations SET is_active = false WHERE id = p_recommendation_id;
  END IF;

  -- Audit
  PERFORM public.fn_emit_audit(
    _action_type := 'recommendation_outcome_recorded',
    _target_type := 'recommendation',
    _target_id := p_recommendation_id::text,
    _result_status := 'success',
    _payload := jsonb_build_object(
      'outcome_kind', p_outcome_kind,
      'mastery_delta', COALESCE(p_mastery_after,0) - COALESCE(p_mastery_before,0),
      'curriculum_id', v_curriculum
    ),
    _trigger_source := 'learner_record_recommendation_outcome',
    _error_message := NULL
  );

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.learner_record_recommendation_outcome(uuid,text,numeric,numeric,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learner_record_recommendation_outcome(uuid,text,numeric,numeric,uuid,jsonb) TO authenticated;

-- 3) Effectiveness view — fuel for self-validating recommendations + future auto-policy
CREATE OR REPLACE VIEW public.v_recommendation_effectiveness AS
SELECT
  ur.recommendation_type,
  ur.reason_code,
  COUNT(DISTINCT ro.id) FILTER (WHERE ro.outcome_kind IN ('practiced','mastered','helpful')) AS positive_outcomes,
  COUNT(DISTINCT ro.id) FILTER (WHERE ro.outcome_kind IN ('dismissed','irrelevant','not_helpful')) AS negative_outcomes,
  COUNT(DISTINCT ro.id) AS total_outcomes,
  ROUND(AVG(ro.mastery_delta) FILTER (WHERE ro.mastery_delta IS NOT NULL), 3) AS avg_mastery_delta,
  COUNT(DISTINCT ur.id) AS total_recommendations,
  ROUND(100.0 * COUNT(DISTINCT ro.id)::numeric / NULLIF(COUNT(DISTINCT ur.id),0), 2) AS feedback_rate_pct
FROM public.user_recommendations ur
LEFT JOIN public.recommendation_outcomes ro ON ro.recommendation_id = ur.id
GROUP BY ur.recommendation_type, ur.reason_code;

REVOKE ALL ON public.v_recommendation_effectiveness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_recommendation_effectiveness TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_recommendation_effectiveness()
RETURNS SETOF public.v_recommendation_effectiveness
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.v_recommendation_effectiveness ORDER BY total_recommendations DESC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_get_recommendation_effectiveness() TO authenticated, service_role;

-- 4) Audit contract
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('recommendation_outcome_recorded', ARRAY['outcome_kind','mastery_delta','curriculum_id']::text[], 'learning_intelligence_outcome_loop')
ON CONFLICT (action_type) DO UPDATE SET required_keys = EXCLUDED.required_keys, owner_module = EXCLUDED.owner_module;
