-- Härtet v_funnel_integrity_check gegen Smoke-Test-Pollution.
-- Smoke-Test-Inserts setzen metadata.smoke_test=true und werden permanent ignoriert.

CREATE OR REPLACE VIEW public.v_funnel_integrity_check AS
WITH window_events AS (
  SELECT ce.event_type, ce.metadata, ce.page_path, ce.user_id, ce.anonymous_id, ce.created_at
  FROM conversion_events ce
  WHERE ce.created_at > (now() - interval '7 days')
    AND ce.event_type = ANY (ARRAY['lead_magnet_view','quiz_started','quiz_completed','lead_capture_submitted','checkout_complete'])
    AND COALESCE((ce.metadata->>'smoke_test')::boolean, false) = false
), per_event AS (
  SELECT event_type,
    count(*)::int AS total,
    count(*) FILTER (WHERE metadata ? 'package_id' AND (metadata->>'package_id') ~ '^[0-9a-f-]{36}$')::int AS with_package_id,
    count(*) FILTER (WHERE metadata ? 'persona' AND length(metadata->>'persona') > 0)::int AS with_persona,
    count(*) FILTER (WHERE page_path IS NOT NULL OR (metadata ? 'source_page' AND length(metadata->>'source_page') > 0))::int AS with_source
  FROM window_events GROUP BY event_type
), totals AS (
  SELECT COALESCE(sum(total),0)::int AS events_total_7d,
    COALESCE(sum(with_persona),0)::int AS with_persona_total,
    COALESCE(sum(with_source),0)::int AS with_source_total,
    COALESCE(sum(total) FILTER (WHERE event_type = ANY (ARRAY['quiz_started','quiz_completed','lead_capture_submitted','checkout_complete'])),0)::int AS strict_events_total,
    COALESCE(sum(with_package_id) FILTER (WHERE event_type = ANY (ARRAY['quiz_started','quiz_completed','lead_capture_submitted','checkout_complete'])),0)::int AS strict_events_with_pkg,
    bool_or(event_type = 'lead_magnet_view') AS has_lead_magnet_view,
    bool_or(event_type = 'quiz_started') AS has_quiz_started,
    bool_or(event_type = 'quiz_completed') AS has_quiz_completed,
    bool_or(event_type = 'lead_capture_submitted') AS has_lead_capture,
    bool_or(event_type = 'checkout_complete') AS has_checkout_complete
  FROM per_event
), funnel_drops AS (
  SELECT COALESCE(sum(total) FILTER (WHERE event_type='lead_magnet_view'),0)::int AS s1_lead_magnet,
    COALESCE(sum(total) FILTER (WHERE event_type='quiz_started'),0)::int AS s2_quiz_started,
    COALESCE(sum(total) FILTER (WHERE event_type='quiz_completed'),0)::int AS s3_quiz_completed,
    COALESCE(sum(total) FILTER (WHERE event_type='lead_capture_submitted'),0)::int AS s4_lead_capture,
    COALESCE(sum(total) FILTER (WHERE event_type='checkout_complete'),0)::int AS s5_checkout
  FROM per_event
), sub AS (
  SELECT t.*, fd.*,
    CASE
      WHEN t.strict_events_total = 0 THEN 'yellow'
      WHEN (t.strict_events_with_pkg::float / NULLIF(t.strict_events_total,0)) >= 0.95 THEN 'green'
      WHEN (t.strict_events_with_pkg::float / NULLIF(t.strict_events_total,0)) >= 0.50 THEN 'yellow'
      ELSE 'red'
    END AS s_tracking,
    CASE
      WHEN NOT (t.has_lead_magnet_view AND t.has_quiz_started AND t.has_quiz_completed AND t.has_lead_capture) THEN 'red'
      WHEN NOT t.has_checkout_complete THEN 'yellow'
      WHEN fd.s3_quiz_completed > 5 AND (fd.s4_lead_capture::float / fd.s3_quiz_completed) < 0.30 THEN 'yellow'
      ELSE 'green'
    END AS s_continuity,
    CASE
      WHEN t.events_total_7d = 0 THEN 'yellow'
      WHEN (t.with_source_total::float / t.events_total_7d) >= 0.90 AND (t.with_persona_total::float / t.events_total_7d) >= 0.50 THEN 'green'
      WHEN (t.with_source_total::float / t.events_total_7d) >= 0.50 THEN 'yellow'
      ELSE 'red'
    END AS s_attribution
  FROM totals t, funnel_drops fd
)
SELECT strict_events_total, strict_events_with_pkg,
  CASE WHEN strict_events_total = 0 THEN 100::numeric(5,1)
       ELSE round(100.0 * strict_events_with_pkg::numeric / strict_events_total::numeric, 1) END AS tracking_completeness_pct,
  s_tracking AS tracking_completeness_status,
  s1_lead_magnet, s2_quiz_started, s3_quiz_completed, s4_lead_capture, s5_checkout,
  s_continuity AS funnel_continuity_status,
  with_persona_total, with_source_total,
  CASE WHEN events_total_7d = 0 THEN 100::numeric(5,1)
       ELSE round(100.0 * with_persona_total::numeric / events_total_7d::numeric, 1) END AS persona_coverage_pct,
  CASE WHEN events_total_7d = 0 THEN 100::numeric(5,1)
       ELSE round(100.0 * with_source_total::numeric / events_total_7d::numeric, 1) END AS source_coverage_pct,
  s_attribution AS attribution_quality_status,
  events_total_7d,
  CASE
    WHEN events_total_7d = 0 THEN 'red'
    WHEN 'red' IN (s_tracking, s_continuity, s_attribution) THEN 'red'
    WHEN 'yellow' IN (s_tracking, s_continuity, s_attribution) THEN 'yellow'
    ELSE 'green'
  END AS status,
  now() AS checked_at
FROM sub;

REVOKE ALL ON public.v_funnel_integrity_check FROM anon, authenticated;
GRANT SELECT ON public.v_funnel_integrity_check TO service_role;

COMMENT ON VIEW public.v_funnel_integrity_check IS
'Funnel integrity over last 7 days. Excludes events with metadata.smoke_test=true (CI smoke harness pollution guard).';

-- Best-Effort-Cleanup-RPC: löscht Smoke-Events älter als 1h (Sicherheitsnetz)
CREATE OR REPLACE FUNCTION public.admin_cleanup_smoke_conversion_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM conversion_events
  WHERE COALESCE((metadata->>'smoke_test')::boolean, false) = true
    AND created_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cleanup_smoke_conversion_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_smoke_conversion_events() TO service_role;