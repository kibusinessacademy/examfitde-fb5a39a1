-- 1) Remaining Producers RPC: aggregates guard_block_building_revert + admin_force_publish forensics
CREATE OR REPLACE FUNCTION public.admin_get_remaining_revert_producers(
  p_window_hours int DEFAULT 168  -- 7 days
)
RETURNS TABLE(
  target_id text,
  events bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  apps jsonb,
  users jsonb,
  client_addrs jsonb,
  trigger_sources jsonb,
  likely_cron text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      l.target_id,
      l.created_at,
      NULLIF(l.metadata->>'application_name','') AS app,
      NULLIF(l.metadata->>'usename','')          AS usename,
      NULLIF(l.metadata->>'client_addr','')      AS client_addr,
      NULLIF(l.trigger_source,'')                AS trigger_source,
      NULLIF(l.metadata->>'caller_query','')     AS caller_query
    FROM public.auto_heal_log l
    WHERE l.action_type = 'guard_block_building_revert'
      AND l.created_at > now() - make_interval(hours => p_window_hours)
      AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ),
  agg AS (
    SELECT
      target_id,
      count(*) AS events,
      min(created_at) AS first_seen,
      max(created_at) AS last_seen,
      jsonb_agg(DISTINCT app) FILTER (WHERE app IS NOT NULL)              AS apps,
      jsonb_agg(DISTINCT usename) FILTER (WHERE usename IS NOT NULL)      AS users,
      jsonb_agg(DISTINCT client_addr) FILTER (WHERE client_addr IS NOT NULL) AS client_addrs,
      jsonb_agg(DISTINCT trigger_source) FILTER (WHERE trigger_source IS NOT NULL) AS trigger_sources,
      mode() WITHIN GROUP (ORDER BY caller_query) AS top_caller
    FROM base
    GROUP BY target_id
  )
  SELECT
    target_id, events, first_seen, last_seen, apps, users, client_addrs, trigger_sources,
    CASE
      WHEN top_caller ILIKE '%pipeline-watchdog%'   THEN 'pipeline-watchdog'
      WHEN top_caller ILIKE '%production-watchdog%' THEN 'production-watchdog'
      WHEN top_caller ILIKE '%production-guardian%' THEN 'production-guardian'
      WHEN top_caller ILIKE '%stuck-scan%'          THEN 'stuck-scan-*'
      WHEN top_caller ILIKE '%prebuild-autofix%'    THEN 'prebuild-autofix'
      WHEN top_caller ILIKE '%regenerate-weak-lessons%' THEN 'regenerate-weak-lessons'
      WHEN top_caller ILIKE '%setup-course-package%' THEN 'setup-course-package'
      WHEN top_caller ILIKE '%admin-ops%'           THEN 'admin-ops*'
      ELSE COALESCE(LEFT(top_caller, 80), 'unknown')
    END AS likely_cron
  FROM agg
  ORDER BY events DESC, last_seen DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_remaining_revert_producers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_remaining_revert_producers(int) TO authenticated;

-- 2) Cron-triggered alert: any new revert events in last 20 minutes → admin notification row
CREATE OR REPLACE FUNCTION public.cron_alert_remaining_revert_producers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events int;
  v_payload jsonb;
BEGIN
  WITH recent AS (
    SELECT
      target_id,
      count(*) AS n,
      max(created_at) AS last_seen,
      jsonb_agg(DISTINCT metadata->>'application_name') FILTER (WHERE metadata->>'application_name' IS NOT NULL) AS apps,
      jsonb_agg(DISTINCT metadata->>'usename')          FILTER (WHERE metadata->>'usename' IS NOT NULL)          AS users,
      jsonb_agg(DISTINCT metadata->>'client_addr')      FILTER (WHERE metadata->>'client_addr' IS NOT NULL)      AS client_addrs
    FROM public.auto_heal_log
    WHERE action_type = 'guard_block_building_revert'
      AND created_at > now() - interval '20 minutes'
    GROUP BY target_id
  )
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
    'target_id', target_id, 'n', n, 'last_seen', last_seen,
    'apps', apps, 'users', users, 'client_addrs', client_addrs
  )), '[]'::jsonb)
  INTO v_events, v_payload
  FROM recent;

  IF v_events > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'remaining_producer_alert',
      'cron_alert_remaining_revert_producers',
      'system',
      NULL,
      'alert',
      format('Remaining building→queued revert producers in last 20min: %s target(s)', v_events),
      jsonb_build_object('event_count', v_events, 'producers', v_payload, 'window', '20 minutes')
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'targets', v_events, 'producers', v_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.cron_alert_remaining_revert_producers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_alert_remaining_revert_producers() TO service_role;

COMMENT ON FUNCTION public.admin_get_remaining_revert_producers(int) IS
'Admin-only: aggregated forensics for remaining guard_block_building_revert producers (target_id, first/last seen, apps, users, client_addrs, likely cron).';
COMMENT ON FUNCTION public.cron_alert_remaining_revert_producers() IS
'Cron alert: writes an auto_heal_log entry with action_type=remaining_producer_alert when any new revert events occur in the last 20 minutes.';