-- 1. Add status/error columns to stripe_event_log
ALTER TABLE public.stripe_event_log
  ADD COLUMN IF NOT EXISTS process_status text NOT NULL DEFAULT 'received'
    CHECK (process_status IN ('received','ok','error','skipped')),
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS handler_duration_ms integer,
  ADD COLUMN IF NOT EXISTS handler_notes jsonb;

CREATE INDEX IF NOT EXISTS idx_stripe_event_log_received_at_desc
  ON public.stripe_event_log (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_event_log_status_type
  ON public.stripe_event_log (process_status, event_type, received_at DESC);

-- 2. RPC: list recent events (admin-only)
CREATE OR REPLACE FUNCTION public.admin_get_stripe_event_log(
  _limit int DEFAULT 100,
  _event_type_filter text DEFAULT NULL,
  _status_filter text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  stripe_event_id text,
  event_type text,
  livemode boolean,
  process_status text,
  error_message text,
  handler_duration_ms integer,
  received_at timestamptz,
  processed_at timestamptz,
  payload jsonb,
  handler_notes jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, stripe_event_id, event_type, livemode, process_status, error_message,
         handler_duration_ms, received_at, processed_at, payload, handler_notes
  FROM public.stripe_event_log
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (_event_type_filter IS NULL OR event_type = _event_type_filter)
    AND (_status_filter IS NULL OR process_status = _status_filter)
  ORDER BY received_at DESC
  LIMIT LEAST(GREATEST(_limit, 1), 500);
$$;

REVOKE ALL ON FUNCTION public.admin_get_stripe_event_log(int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stripe_event_log(int, text, text) TO authenticated;

-- 3. RPC: summary stats (counts by type + status, 24h/7d)
CREATE OR REPLACE FUNCTION public.admin_get_stripe_event_log_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.has_role(auth.uid(), 'admin'::app_role) THEN jsonb_build_object('error', 'forbidden')
    ELSE jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.stripe_event_log),
      'last_24h', (SELECT COUNT(*) FROM public.stripe_event_log WHERE received_at > now() - interval '24 hours'),
      'last_7d', (SELECT COUNT(*) FROM public.stripe_event_log WHERE received_at > now() - interval '7 days'),
      'by_status', (
        SELECT COALESCE(jsonb_object_agg(process_status, c), '{}'::jsonb)
        FROM (
          SELECT process_status, COUNT(*) AS c
          FROM public.stripe_event_log
          WHERE received_at > now() - interval '7 days'
          GROUP BY process_status
        ) s
      ),
      'by_type', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('event_type', event_type, 'count', c, 'errors', e) ORDER BY c DESC), '[]'::jsonb)
        FROM (
          SELECT event_type,
                 COUNT(*) AS c,
                 COUNT(*) FILTER (WHERE process_status = 'error') AS e
          FROM public.stripe_event_log
          WHERE received_at > now() - interval '7 days'
          GROUP BY event_type
        ) t
      ),
      'recent_errors', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'stripe_event_id', stripe_event_id,
          'event_type', event_type,
          'error_message', error_message,
          'received_at', received_at
        ) ORDER BY received_at DESC), '[]'::jsonb)
        FROM (
          SELECT stripe_event_id, event_type, error_message, received_at
          FROM public.stripe_event_log
          WHERE process_status = 'error'
          ORDER BY received_at DESC
          LIMIT 10
        ) er
      )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_stripe_event_log_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stripe_event_log_summary() TO authenticated;