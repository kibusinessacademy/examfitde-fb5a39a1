
BEGIN;

-- 1. CONTROL PLANE POLICIES
CREATE TABLE IF NOT EXISTS public.control_plane_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  severity text NOT NULL DEFAULT 'warn',
  threshold_numeric numeric,
  threshold_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_mode text NOT NULL DEFAULT 'alert_only',
  description text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_plane_policies_severity_chk CHECK (severity IN ('info','warn','critical')),
  CONSTRAINT control_plane_policies_action_mode_chk CHECK (action_mode IN ('alert_only','auto_pause','auto_resume','auto_heal','auto_throttle'))
);

INSERT INTO public.control_plane_policies (policy_key, is_enabled, severity, threshold_numeric, action_mode, description)
VALUES
  ('queue_failed_1h', true, 'warn', 25, 'alert_only', 'Warn if failed jobs in last hour exceed threshold'),
  ('queue_failed_critical_1h', true, 'critical', 75, 'auto_throttle', 'Throttle if failed jobs in last hour exceed critical threshold'),
  ('content_hollow_ratio', true, 'critical', 0.15, 'auto_pause', 'Pause content-heavy flows if hollow ratio exceeds threshold'),
  ('distribution_fail_ratio', true, 'warn', 0.20, 'alert_only', 'Warn when distribution failure ratio is too high'),
  ('optimization_action_backlog', true, 'warn', 100, 'alert_only', 'Warn if optimization action backlog grows too high'),
  ('wave_blocked_count', true, 'warn', 10, 'alert_only', 'Warn if blocked wave items exceed threshold'),
  ('daily_cost_estimate', true, 'critical', 250, 'auto_throttle', 'Throttle if estimated daily cost exceeds threshold')
ON CONFLICT (policy_key) DO NOTHING;

-- 2. CONTROL PLANE SNAPSHOTS
CREATE TABLE IF NOT EXISTS public.control_plane_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_scope text NOT NULL DEFAULT 'global',
  snapshot_key text NOT NULL DEFAULT 'system',
  health_score numeric NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'healthy',
  intake jsonb NOT NULL DEFAULT '{}'::jsonb,
  production jsonb NOT NULL DEFAULT '{}'::jsonb,
  revenue jsonb NOT NULL DEFAULT '{}'::jsonb,
  campaigns jsonb NOT NULL DEFAULT '{}'::jsonb,
  distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  optimization jsonb NOT NULL DEFAULT '{}'::jsonb,
  finance jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_plane_snapshots_status_chk CHECK (status IN ('healthy','warning','degraded','critical'))
);

CREATE INDEX IF NOT EXISTS idx_control_plane_snapshots_created ON public.control_plane_snapshots (created_at DESC);

-- 3. ALERTS
CREATE TABLE IF NOT EXISTS public.control_plane_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  status text NOT NULL DEFAULT 'open',
  source_layer text NOT NULL,
  source_ref text,
  title text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_plane_alerts_severity_chk CHECK (severity IN ('info','warn','critical')),
  CONSTRAINT control_plane_alerts_status_chk CHECK (status IN ('open','acknowledged','resolved'))
);

CREATE INDEX IF NOT EXISTS idx_control_plane_alerts_status ON public.control_plane_alerts (status, severity, last_seen_at DESC);

-- 4. ACTION LOG
CREATE TABLE IF NOT EXISTS public.control_plane_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  action_scope text NOT NULL DEFAULT 'global',
  status text NOT NULL DEFAULT 'queued',
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT control_plane_actions_status_chk CHECK (status IN ('queued','processing','done','failed','skipped'))
);

-- 5. COST SIGNALS
CREATE TABLE IF NOT EXISTS public.control_plane_cost_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_date date NOT NULL DEFAULT current_date,
  layer_key text NOT NULL,
  metric_key text NOT NULL,
  metric_value numeric NOT NULL DEFAULT 0,
  metric_unit text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_cost_signals_lookup ON public.control_plane_cost_signals (signal_date DESC, layer_key, metric_key);

-- 6. HELPERS
CREATE OR REPLACE FUNCTION public.upsert_control_plane_alert(
  p_alert_key text,
  p_severity text,
  p_source_layer text,
  p_source_ref text,
  p_title text,
  p_message text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.control_plane_alerts
  WHERE alert_key = p_alert_key
    AND status IN ('open','acknowledged')
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.control_plane_alerts (
      alert_key, severity, source_layer, source_ref, title, message, payload
    )
    VALUES (
      p_alert_key, p_severity, p_source_layer, p_source_ref, p_title, p_message, coalesce(p_payload, '{}'::jsonb)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.control_plane_alerts
    SET severity = p_severity,
        source_layer = p_source_layer,
        source_ref = p_source_ref,
        title = p_title,
        message = p_message,
        payload = coalesce(p_payload, '{}'::jsonb),
        last_seen_at = now(),
        updated_at = now()
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_control_plane_alerts_by_prefix(
  p_alert_key_prefix text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.control_plane_alerts
  SET status = 'resolved',
      resolved_at = now(),
      updated_at = now()
  WHERE status IN ('open','acknowledged')
    AND alert_key LIKE p_alert_key_prefix || '%';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMIT;
