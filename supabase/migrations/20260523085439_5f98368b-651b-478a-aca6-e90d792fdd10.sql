-- P20 Cut 0A — Wiring Closure: Admin-RPC for AI Runtime Intervention Tab
-- Wraps existing view v_recommendation_policy_effectiveness behind has_role gate.

CREATE OR REPLACE FUNCTION public.admin_get_recommendation_policy_effectiveness()
RETURNS TABLE (
  recommendation_type text,
  reason_code text,
  outcomes_total bigint,
  positive_count bigint,
  negative_count bigint,
  positive_rate_pct numeric,
  avg_mastery_delta numeric,
  distinct_users bigint,
  last_recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    v.recommendation_type,
    v.reason_code,
    v.outcomes_total,
    v.positive_count,
    v.negative_count,
    v.positive_rate_pct,
    v.avg_mastery_delta,
    v.distinct_users,
    v.last_recorded_at
  FROM public.v_recommendation_policy_effectiveness v
  ORDER BY v.outcomes_total DESC NULLS LAST, v.recommendation_type, v.reason_code;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_recommendation_policy_effectiveness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_recommendation_policy_effectiveness() TO authenticated;

COMMENT ON FUNCTION public.admin_get_recommendation_policy_effectiveness() IS
  'P20 Cut 0A — read-only Admin-RPC für AI Runtime Intervention Tab. Wrappt v_recommendation_policy_effectiveness mit has_role-Gate.';
