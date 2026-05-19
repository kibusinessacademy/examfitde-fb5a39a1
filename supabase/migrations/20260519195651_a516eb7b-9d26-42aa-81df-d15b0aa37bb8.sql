-- Add errors_24h to summary RPC for alert KPI
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
      'errors_24h', (SELECT COUNT(*) FROM public.stripe_event_log
                     WHERE received_at > now() - interval '24 hours' AND process_status = 'error'),
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