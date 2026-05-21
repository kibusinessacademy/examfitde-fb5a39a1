
CREATE TABLE IF NOT EXISTS public.ai_observability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  model text NOT NULL DEFAULT 'unknown',
  job_type text NOT NULL DEFAULT 'unknown',
  request_id text,
  package_id uuid,
  user_id uuid,
  observed_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ai_obs_event_kind_chk CHECK (event_kind IN (
    'hallucination','grounding_miss','scope_violation','eval_drift',
    'generation_rollback','citation_missing','schema_violation','quality_drop'
  )),
  CONSTRAINT ai_obs_severity_chk CHECK (severity IN ('info','warning','critical'))
);

CREATE INDEX IF NOT EXISTS idx_ai_obs_events_kind_model_time
  ON public.ai_observability_events (event_kind, model, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_obs_events_job_time
  ON public.ai_observability_events (job_type, observed_at DESC);

ALTER TABLE public.ai_observability_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_obs_admin_read" ON public.ai_observability_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "ai_obs_service_write" ON public.ai_observability_events TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.v_ai_model_health AS
SELECT
  model,
  job_type,
  COUNT(*) AS events_total,
  COUNT(*) FILTER (WHERE event_kind='hallucination')        AS hallucinations,
  COUNT(*) FILTER (WHERE event_kind='grounding_miss')       AS grounding_misses,
  COUNT(*) FILTER (WHERE event_kind='scope_violation')      AS scope_violations,
  COUNT(*) FILTER (WHERE event_kind='eval_drift')           AS eval_drifts,
  COUNT(*) FILTER (WHERE event_kind='generation_rollback')  AS rollbacks,
  COUNT(*) FILTER (WHERE event_kind='citation_missing')     AS citation_missing,
  COUNT(*) FILTER (WHERE severity='critical')               AS critical_events,
  ROUND(100.0 * COUNT(*) FILTER (WHERE event_kind='hallucination')   / NULLIF(COUNT(*),0), 2) AS hallucination_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE event_kind='grounding_miss')  / NULLIF(COUNT(*),0), 2) AS grounding_miss_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE event_kind='scope_violation') / NULLIF(COUNT(*),0), 2) AS scope_violation_rate_pct,
  MAX(observed_at) AS last_observed_at
FROM public.ai_observability_events
WHERE observed_at > now() - interval '7 days'
GROUP BY 1,2;

REVOKE ALL ON public.v_ai_model_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ai_model_health TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_ai_observability_summary(p_window_hours int DEFAULT 168)
RETURNS TABLE(model text, job_type text, events_total bigint,
  hallucinations bigint, grounding_misses bigint, scope_violations bigint,
  eval_drifts bigint, rollbacks bigint, critical_events bigint,
  hallucination_rate_pct numeric, grounding_miss_rate_pct numeric,
  scope_violation_rate_pct numeric, last_observed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT model, job_type, COUNT(*) AS events_total,
    COUNT(*) FILTER (WHERE event_kind='hallucination')       AS hallucinations,
    COUNT(*) FILTER (WHERE event_kind='grounding_miss')      AS grounding_misses,
    COUNT(*) FILTER (WHERE event_kind='scope_violation')     AS scope_violations,
    COUNT(*) FILTER (WHERE event_kind='eval_drift')          AS eval_drifts,
    COUNT(*) FILTER (WHERE event_kind='generation_rollback') AS rollbacks,
    COUNT(*) FILTER (WHERE severity='critical')              AS critical_events,
    ROUND(100.0 * COUNT(*) FILTER (WHERE event_kind='hallucination')   / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE event_kind='grounding_miss')  / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE event_kind='scope_violation') / NULLIF(COUNT(*),0), 2),
    MAX(observed_at)
  FROM public.ai_observability_events
  WHERE observed_at > now() - make_interval(hours => p_window_hours)
    AND public.has_role(auth.uid(),'admin'::app_role)
  GROUP BY model, job_type
  ORDER BY events_total DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_get_ai_observability_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ai_observability_summary(int) TO authenticated;

INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES ('ai_observability_event_logged',
        ARRAY['event_kind','model','severity'], 'ai_governance')
ON CONFLICT (action_type) DO NOTHING;
