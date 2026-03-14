
-- A/B Test Report: Vergleicht Modell-Performance aus llm_cost_events
-- Liefert pro Modell/Intent: Calls, Kosten, Tokens, Ø-Kosten
-- Filtert auf konfigurierbare Zeitfenster

CREATE OR REPLACE FUNCTION public.get_ab_test_report(
  p_window_hours integer DEFAULT 48,
  p_job_types text[] DEFAULT NULL
)
RETURNS TABLE (
  model text,
  provider text,
  job_type text,
  calls bigint,
  total_cost_eur numeric,
  avg_cost_eur numeric,
  total_tokens_in bigint,
  total_tokens_out bigint,
  avg_tokens_out numeric,
  first_call timestamptz,
  last_call timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.model,
    e.provider,
    e.job_type,
    COUNT(*)::bigint AS calls,
    ROUND(SUM(e.cost_eur)::numeric, 4) AS total_cost_eur,
    ROUND(AVG(e.cost_eur)::numeric, 6) AS avg_cost_eur,
    COALESCE(SUM(e.tokens_in)::bigint, 0) AS total_tokens_in,
    COALESCE(SUM(e.tokens_out)::bigint, 0) AS total_tokens_out,
    ROUND(AVG(e.tokens_out)::numeric, 0) AS avg_tokens_out,
    MIN(e.ts) AS first_call,
    MAX(e.ts) AS last_call
  FROM llm_cost_events e
  WHERE e.ts > now() - make_interval(hours => p_window_hours)
    AND e.model IS NOT NULL
    AND (p_job_types IS NULL OR e.job_type = ANY(p_job_types))
  GROUP BY e.model, e.provider, e.job_type
  ORDER BY calls DESC;
$$;

-- Täglicher A/B-Report als Admin-Notification (pg_cron: täglich 08:00 UTC)
CREATE OR REPLACE FUNCTION public.notify_ab_test_daily()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report jsonb;
  v_top_models jsonb;
  v_body text;
BEGIN
  -- Letzte 24h aggregieren
  SELECT jsonb_agg(row_to_json(r))
  INTO v_report
  FROM (
    SELECT model, provider, job_type, calls, total_cost_eur, avg_cost_eur, total_tokens_out, avg_tokens_out
    FROM get_ab_test_report(24)
    WHERE calls >= 5
    ORDER BY calls DESC
    LIMIT 10
  ) r;

  IF v_report IS NULL OR jsonb_array_length(v_report) = 0 THEN
    RETURN; -- Keine Daten, keine Notification
  END IF;

  -- Top 3 Modelle für Body-Text
  SELECT string_agg(
    format('%s: %s calls, €%s avg', elem->>'model', elem->>'calls', elem->>'avg_cost_eur'),
    E'\n'
  )
  INTO v_body
  FROM jsonb_array_elements(v_report) WITH ORDINALITY AS t(elem, idx)
  WHERE idx <= 5;

  INSERT INTO admin_notifications (title, body, category, severity, metadata, entity_type)
  VALUES (
    'A/B Test Report (24h)',
    v_body,
    'ai_ops',
    'info',
    jsonb_build_object('report', v_report, 'window_hours', 24),
    'ab_test'
  );
END;
$$;

-- pg_cron Job: täglich um 08:00 UTC
SELECT cron.schedule(
  'ab-test-daily-report',
  '0 8 * * *',
  $$SELECT public.notify_ab_test_daily();$$
);
