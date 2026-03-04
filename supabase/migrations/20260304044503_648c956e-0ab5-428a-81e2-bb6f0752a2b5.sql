
-- 1) Hard invariant: completed job MUST have a result
ALTER TABLE public.job_queue
ADD CONSTRAINT job_completed_requires_result
CHECK (status <> 'completed' OR result IS NOT NULL);

-- 2) Pipeline settings for circuit breaker / feature flags
CREATE TABLE IF NOT EXISTS public.pipeline_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_settings ENABLE ROW LEVEL SECURITY;

-- Service-role only
CREATE POLICY "Service role full access on pipeline_settings"
  ON public.pipeline_settings FOR ALL
  USING (true) WITH CHECK (true);

-- Defaults
INSERT INTO public.pipeline_settings(key, value)
VALUES
  ('ai_tool_mode', '{"enabled": true, "reason": null, "updated_by": "migration"}'::jsonb),
  ('stall_guard',  '{"enabled": true, "auto_mitigate": true, "stall_minutes": 60, "lookback_minutes": 60}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3) Health events log (SSOT for incidents)
CREATE TABLE IF NOT EXISTS public.pipeline_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL CHECK (severity IN ('P0','P1','P2')),
  kind text NOT NULL,
  package_id uuid NULL,
  step_key text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.pipeline_health_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on pipeline_health_events"
  ON public.pipeline_health_events FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pipeline_health_events_created_at
  ON public.pipeline_health_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_health_events_kind
  ON public.pipeline_health_events(kind);

-- 4) Helper RPC: upsert pipeline setting
CREATE OR REPLACE FUNCTION public.set_pipeline_setting(p_key text, p_value jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pipeline_settings(key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_pipeline_setting(text, jsonb) FROM public;

-- 5) Helper RPC: log health event
CREATE OR REPLACE FUNCTION public.log_pipeline_health_event(
  p_severity text,
  p_kind text,
  p_package_id uuid DEFAULT NULL,
  p_step_key text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.pipeline_health_events(severity, kind, package_id, step_key, meta)
  VALUES (p_severity, p_kind, p_package_id, p_step_key, COALESCE(p_meta, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_pipeline_health_event(text, text, uuid, text, jsonb) FROM public;

-- 6) View: stalled packages (Golden Metric = Write-Rate)
CREATE OR REPLACE VIEW public.v_pipeline_stalled_packages AS
WITH cfg AS (
  SELECT
    COALESCE((value->>'stall_minutes')::int, 60) AS stall_minutes,
    COALESCE((value->>'lookback_minutes')::int, 60) AS lookback_minutes
  FROM public.pipeline_settings
  WHERE key = 'stall_guard'
),
latest_write AS (
  SELECT cp.id AS package_id, MAX(cv.created_at) AS last_write
  FROM public.content_versions cv
  JOIN public.course_packages cp ON cp.course_id = cv.course_id
  GROUP BY cp.id
),
recent_completions AS (
  SELECT package_id, COUNT(*) AS completed_jobs
  FROM public.job_queue
  WHERE status = 'completed'
    AND completed_at >= now() - ((SELECT lookback_minutes FROM cfg) || ' minutes')::interval
    AND package_id IS NOT NULL
  GROUP BY 1
)
SELECT
  cp.id AS package_id,
  cp.status,
  lw.last_write,
  rc.completed_jobs
FROM public.course_packages cp
LEFT JOIN latest_write lw ON lw.package_id = cp.id
LEFT JOIN recent_completions rc ON rc.package_id = cp.id
WHERE cp.status = 'building'
  AND COALESCE(lw.last_write, '1970-01-01'::timestamptz)
      < now() - ((SELECT stall_minutes FROM cfg) || ' minutes')::interval
  AND COALESCE(rc.completed_jobs, 0) > 0;
