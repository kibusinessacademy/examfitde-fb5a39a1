
-- Reality-Bridge v1: DNA × Arbeitsmarkt × Oral × DailyBrief
-- Read-only. Keine neuen Tabellen. SECURITY DEFINER + has_role-Gate auf DailyBrief-Ebene.

-- 1) Kanonische Marktquery-Ableitung pro Fachbereich
--    Heuristik: department_name → erstes Segment vor "/" oder " " (z.B. "Bauamt / Bauverwaltung" → "Bauamt").
--    Strikt deterministisch, IMMUTABLE-fähig (aber STABLE wegen Tabellen-Lookup).
CREATE OR REPLACE FUNCTION public.fn_verwaltung_market_query(_department_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    trim(
      split_part(
        split_part(d.department_name, '/', 1),
        '(', 1
      )
    )
  FROM public.verwaltung_department_dna d
  WHERE d.department_key = _department_key
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.fn_verwaltung_market_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_verwaltung_market_query(text) TO anon, authenticated, service_role;

-- 2) Reality-Bridge RPC: pro Fachbereich Oral-Eskalation + kanonische Marktquery + Risk-Cluster
--    Read-only Aggregation aus v_verwaltung_daily_brief_signals + DNA. Kein Bund-API-Call (bleibt im Edge).
CREATE OR REPLACE FUNCTION public.verwaltung_daily_brief_reality_bridge(
  _window_days int DEFAULT 7,
  _limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('error', 'forbidden', 'reason', 'admin_role_required');
  END IF;

  IF _window_days NOT IN (1, 7, 30) THEN
    _window_days := 7;
  END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 50 THEN
    _limit := 20;
  END IF;

  WITH base AS (
    SELECT
      d.department_key,
      d.department_name,
      d.category,
      public.fn_verwaltung_market_query(d.department_key) AS market_query,
      COALESCE(
        CASE _window_days
          WHEN 1 THEN s.sessions_24h
          WHEN 7 THEN s.sessions_7d
          WHEN 30 THEN s.sessions_30d
        END,
        0
      ) AS sessions,
      COALESCE(s.avg_escalation_7d, 0)::numeric(4,2) AS avg_escalation,
      COALESCE(s.high_conflict_pct_7d, 0)::numeric(5,2) AS high_conflict_pct,
      jsonb_array_length(COALESCE(d.use_cases, '[]'::jsonb)) AS use_case_count,
      jsonb_array_length(COALESCE(d.oral_training_cases, '[]'::jsonb)) AS oral_case_count
    FROM public.verwaltung_department_dna d
    LEFT JOIN public.v_verwaltung_daily_brief_signals s ON s.department_key = d.department_key
  )
  SELECT jsonb_build_object(
    'window_days', _window_days,
    'generated_at', now(),
    'departments', COALESCE(jsonb_agg(
      jsonb_build_object(
        'department_key', b.department_key,
        'department_name', b.department_name,
        'category', b.category,
        'market_query', b.market_query,
        'oral_sessions', b.sessions,
        'avg_escalation', b.avg_escalation,
        'high_conflict_pct', b.high_conflict_pct,
        'use_case_count', b.use_case_count,
        'oral_case_count', b.oral_case_count,
        'reality_priority',
          CASE
            WHEN b.avg_escalation >= 3.5 THEN 'HIGH'
            WHEN b.avg_escalation >= 2.0 THEN 'MEDIUM'
            WHEN b.sessions > 0 THEN 'LOW'
            ELSE 'IDLE'
          END
      )
      ORDER BY b.avg_escalation DESC NULLS LAST, b.sessions DESC NULLS LAST
    ) FILTER (WHERE b.department_key IS NOT NULL), '[]'::jsonb)
  )
  INTO _result
  FROM (SELECT * FROM base ORDER BY avg_escalation DESC NULLS LAST, sessions DESC NULLS LAST LIMIT _limit) b;

  RETURN COALESCE(_result, jsonb_build_object(
    'window_days', _window_days,
    'generated_at', now(),
    'departments', '[]'::jsonb
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_daily_brief_reality_bridge(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verwaltung_daily_brief_reality_bridge(int, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_verwaltung_market_query IS
  'Reality-Bridge v1: kanonische BA-Jobsuche-Query aus department_name (erstes Segment).';
COMMENT ON FUNCTION public.verwaltung_daily_brief_reality_bridge IS
  'Reality-Bridge v1: per-Fachbereich Oral-Eskalation + Marktquery + Priority. Admin-gated.';
