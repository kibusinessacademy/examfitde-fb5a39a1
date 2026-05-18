
CREATE OR REPLACE VIEW public.v_activation_assurance_ssot AS
WITH base AS (
  SELECT
    s.*,
    LEAST(s.first_minicheck_completed_at, s.first_tutor_feedback_at) AS first_value_at
  FROM public.v_post_purchase_activation_ssot s
)
SELECT
  b.grant_id, b.user_id, b.package_id, b.package_key, b.curriculum_id, b.track,
  b.paid_at, b.first_login_at, b.welcome_seen_at,
  b.first_minicheck_started_at, b.first_minicheck_completed_at,
  b.first_tutor_feedback_at, b.lernplan_started_at, b.first_value_at,
  CASE
    WHEN b.lernplan_started_at IS NOT NULL THEN 'lernplan_started'
    WHEN b.first_tutor_feedback_at IS NOT NULL THEN 'aha_completed'
    WHEN b.first_minicheck_completed_at IS NOT NULL THEN 'first_minicheck_completed'
    WHEN b.first_minicheck_started_at IS NOT NULL THEN 'first_minicheck_started'
    WHEN b.welcome_seen_at IS NOT NULL THEN 'welcome_seen'
    ELSE 'grant_created'
  END AS current_stage,
  CASE
    WHEN b.welcome_seen_at IS NULL THEN 'open_welcome'
    WHEN b.first_minicheck_started_at IS NULL THEN 'start_minicheck'
    WHEN b.first_minicheck_completed_at IS NULL THEN 'complete_minicheck'
    WHEN b.first_tutor_feedback_at IS NULL THEN 'view_aha_feedback'
    WHEN b.lernplan_started_at IS NULL THEN 'start_learning_plan'
    ELSE 'none'
  END AS missing_next_step,
  CASE
    WHEN b.lernplan_started_at IS NOT NULL THEN NULL
    WHEN b.welcome_seen_at IS NULL AND (now() - b.paid_at) > interval '15 minutes' THEN 'no_welcome_after_15min'
    WHEN b.welcome_seen_at IS NOT NULL AND b.first_minicheck_started_at IS NULL
         AND (now() - b.welcome_seen_at) > interval '30 minutes' THEN 'no_minicheck_after_30min'
    WHEN b.first_minicheck_completed_at IS NOT NULL AND b.first_tutor_feedback_at IS NULL
         AND (now() - b.first_minicheck_completed_at) > interval '30 minutes' THEN 'no_aha_after_30min'
    WHEN b.first_tutor_feedback_at IS NOT NULL AND b.lernplan_started_at IS NULL
         AND (now() - b.first_tutor_feedback_at) > interval '60 minutes' THEN 'no_lernplan_after_60min'
    WHEN b.first_value_at IS NULL AND (now() - b.paid_at) > interval '24 hours' THEN 'no_first_value_after_24h'
    ELSE NULL
  END AS blocked_reason,
  EXTRACT(epoch FROM (now() - b.paid_at))/60.0 AS minutes_since_grant,
  CASE WHEN b.first_value_at IS NOT NULL
       THEN EXTRACT(epoch FROM (b.first_value_at - b.paid_at))/60.0 ELSE NULL END AS minutes_to_first_value,
  (b.first_value_at IS NOT NULL) AS first_value_reached,
  CASE
    WHEN b.lernplan_started_at IS NOT NULL THEN false
    WHEN b.welcome_seen_at IS NULL AND (now() - b.paid_at) > interval '15 minutes' THEN true
    WHEN b.welcome_seen_at IS NOT NULL AND b.first_minicheck_started_at IS NULL
         AND (now() - b.welcome_seen_at) > interval '30 minutes' THEN true
    WHEN b.first_minicheck_completed_at IS NOT NULL AND b.first_tutor_feedback_at IS NULL
         AND (now() - b.first_minicheck_completed_at) > interval '30 minutes' THEN true
    WHEN b.first_tutor_feedback_at IS NOT NULL AND b.lernplan_started_at IS NULL
         AND (now() - b.first_tutor_feedback_at) > interval '60 minutes' THEN true
    WHEN b.first_value_at IS NULL AND (now() - b.paid_at) > interval '24 hours' THEN true
    ELSE false
  END AS is_stale_activation
FROM base b;

REVOKE ALL ON public.v_activation_assurance_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_activation_assurance_ssot TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_activation_assurance(_window_hours int DEFAULT 48)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
  _cutoff timestamptz := now() - make_interval(hours => GREATEST(_window_hours, 1));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  WITH win AS (
    SELECT * FROM public.v_activation_assurance_ssot WHERE paid_at >= _cutoff
  ),
  totals AS (
    SELECT current_stage, COUNT(*) AS c FROM win GROUP BY current_stage
  ),
  agg AS (
    SELECT
      COUNT(*)::int AS total_grants,
      COUNT(*) FILTER (WHERE is_stale_activation)::int AS stale_count,
      COUNT(*) FILTER (WHERE first_value_reached)::int AS first_value_count,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY minutes_to_first_value)
        FILTER (WHERE minutes_to_first_value IS NOT NULL) AS median_minutes
    FROM win
  ),
  stale_list AS (
    SELECT jsonb_agg(row_to_json(s) ORDER BY s.paid_at DESC) AS items FROM (
      SELECT
        grant_id, package_id, package_key, track,
        ('user_' || substr(encode(digest(user_id::text,'sha256'),'hex'),1,10)) AS learner_ref,
        current_stage, missing_next_step, blocked_reason, is_stale_activation,
        round(minutes_since_grant::numeric, 1) AS minutes_since_grant,
        round(minutes_to_first_value::numeric, 1) AS minutes_to_first_value,
        paid_at
      FROM win
      ORDER BY (is_stale_activation)::int DESC, paid_at DESC
      LIMIT 50
    ) s
  )
  SELECT jsonb_build_object(
    'window_hours', _window_hours,
    'totals_by_stage', COALESCE((SELECT jsonb_object_agg(current_stage, c) FROM totals), '{}'::jsonb),
    'total_grants', (SELECT total_grants FROM agg),
    'stale_count', (SELECT stale_count FROM agg),
    'first_value_count', (SELECT first_value_count FROM agg),
    'first_value_rate_pct', CASE WHEN (SELECT total_grants FROM agg) > 0
        THEN round(100.0 * (SELECT first_value_count FROM agg) / (SELECT total_grants FROM agg), 1)
        ELSE NULL END,
    'median_minutes_to_first_value', (SELECT median_minutes FROM agg),
    'items', COALESCE((SELECT items FROM stale_list), '[]'::jsonb),
    'generated_at', now()
  ) INTO _result;

  BEGIN
    PERFORM public.fn_emit_audit(
      'activation_assurance_viewed', 'system',
      jsonb_build_object('window_hours', _window_hours,
                         'total_grants', _result->>'total_grants',
                         'stale_count', _result->>'stale_count'),
      'success'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_activation_assurance(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_activation_assurance(int) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ops_audit_contract') THEN
    INSERT INTO public.ops_audit_contract(action_type, required_keys)
    VALUES
      ('activation_assurance_viewed', ARRAY['window_hours','total_grants','stale_count']),
      ('activation_stale_detected', ARRAY['grant_id','blocked_reason','minutes_since_grant']),
      ('activation_nudge_planned', ARRAY['grant_id','nudge_type','current_stage'])
    ON CONFLICT (action_type) DO NOTHING;
  END IF;
END $$;
