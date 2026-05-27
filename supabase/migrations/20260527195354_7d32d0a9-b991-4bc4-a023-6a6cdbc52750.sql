
-- =============================================================================
-- VerwaltungsOS DailyBrief v1 — Governance Intelligence Layer (read-only)
-- =============================================================================

-- ----- View: Per-Department Signal Aggregation ------------------------------
CREATE OR REPLACE VIEW public.v_verwaltung_daily_brief_signals AS
WITH session_window AS (
  SELECT
    s.id,
    s.department_key,
    s.oral_case_key,
    s.persona,
    s.conflict_level,
    s.escalation_state,
    s.status,
    s.scores,
    s.started_at,
    s.ended_at
  FROM public.verwaltung_oral_sessions s
  WHERE s.started_at >= now() - interval '30 days'
),
turn_agg AS (
  SELECT
    t.session_id,
    COUNT(*) FILTER (WHERE t.role = 'user') AS user_turns,
    COUNT(*) FILTER (WHERE t.role = 'persona') AS persona_turns,
    MAX(COALESCE((t.evaluation->>'risk_flag')::text, '')) AS any_risk_flag,
    array_remove(array_agg(DISTINCT NULLIF(t.persona_emotion, '')), NULL) AS emotions,
    MAX(GREATEST(COALESCE(t.escalation_delta, 0), 0)) AS max_pos_delta
  FROM public.verwaltung_oral_turns t
  GROUP BY t.session_id
)
SELECT
  sw.department_key,
  COUNT(*) AS sessions_30d,
  COUNT(*) FILTER (WHERE sw.started_at >= now() - interval '24 hours') AS sessions_24h,
  COUNT(*) FILTER (WHERE sw.started_at >= now() - interval '7 days') AS sessions_7d,
  ROUND(AVG(sw.escalation_state)::numeric, 2) AS avg_escalation,
  MAX(sw.escalation_state) AS max_escalation,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE sw.escalation_state >= 3) / NULLIF(COUNT(*), 0),
    1
  ) AS high_conflict_pct,
  COUNT(*) FILTER (WHERE sw.status = 'finalized') AS finalized_sessions,
  ROUND(
    AVG(COALESCE((sw.scores->>'buergerverstaendlichkeit')::numeric, NULL)),
    1
  ) AS avg_buergerverstaendlichkeit,
  ROUND(
    AVG(COALESCE((sw.scores->>'deeskalation')::numeric, NULL)),
    1
  ) AS avg_deeskalation,
  ROUND(
    AVG(COALESCE((sw.scores->>'governance_sicherheit')::numeric, NULL)),
    1
  ) AS avg_governance_sicherheit,
  ROUND(
    AVG(COALESCE((sw.scores->>'empathie')::numeric, NULL)),
    1
  ) AS avg_empathie,
  ROUND(
    AVG(COALESCE((sw.scores->>'fachlichkeit')::numeric, NULL)),
    1
  ) AS avg_fachlichkeit,
  (
    SELECT jsonb_object_agg(emotion, cnt)
    FROM (
      SELECT unnest(ta.emotions) AS emotion, COUNT(*) AS cnt
      FROM turn_agg ta
      JOIN session_window sw2 ON sw2.id = ta.session_id
      WHERE sw2.department_key = sw.department_key
      GROUP BY emotion
      ORDER BY COUNT(*) DESC
      LIMIT 5
    ) e
  ) AS top_emotions,
  (
    SELECT jsonb_agg(jsonb_build_object('persona', persona, 'count', cnt))
    FROM (
      SELECT sw3.persona, COUNT(*) AS cnt
      FROM session_window sw3
      WHERE sw3.department_key = sw.department_key
        AND sw3.persona IS NOT NULL
      GROUP BY sw3.persona
      ORDER BY COUNT(*) DESC
      LIMIT 3
    ) p
  ) AS top_personas
FROM session_window sw
GROUP BY sw.department_key;

REVOKE ALL ON public.v_verwaltung_daily_brief_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_verwaltung_daily_brief_signals TO service_role;

-- ----- RPC: Department Daily Brief ------------------------------------------
CREATE OR REPLACE FUNCTION public.verwaltung_daily_brief_department(
  _department_key text,
  _window_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dna record;
  v_signals record;
  v_recommendation text;
  v_weakest_dim text;
  v_weakest_score numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sysop')) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT department_key, department_name, category, kpis, risks, communication_patterns, escalation_paths
    INTO v_dna
  FROM public.verwaltung_department_dna
  WHERE department_key = _department_key;

  IF v_dna IS NULL THEN
    RETURN jsonb_build_object('error', 'department_not_found');
  END IF;

  SELECT * INTO v_signals
  FROM public.v_verwaltung_daily_brief_signals
  WHERE department_key = _department_key;

  -- Determine weakest score dimension
  SELECT dim, score INTO v_weakest_dim, v_weakest_score FROM (
    VALUES
      ('Bürgerverständlichkeit', COALESCE(v_signals.avg_buergerverstaendlichkeit, 100)),
      ('Deeskalation',           COALESCE(v_signals.avg_deeskalation, 100)),
      ('Governance-Sicherheit',  COALESCE(v_signals.avg_governance_sicherheit, 100)),
      ('Empathie',               COALESCE(v_signals.avg_empathie, 100)),
      ('Fachlichkeit',           COALESCE(v_signals.avg_fachlichkeit, 100))
  ) AS x(dim, score)
  ORDER BY score ASC
  LIMIT 1;

  -- Simulation-based recommendation
  IF v_signals.sessions_7d IS NULL OR v_signals.sessions_7d = 0 THEN
    v_recommendation := 'Keine Simulationsdaten im Zeitfenster — Trainings-Cadence im Fachbereich erhöhen.';
  ELSIF v_signals.high_conflict_pct >= 40 THEN
    v_recommendation := format(
      'Hoher Anteil eskalierender Gespräche (%s%%). Kommunikations-Coaching für %s priorisieren.',
      v_signals.high_conflict_pct, v_dna.department_name
    );
  ELSIF v_weakest_score < 70 THEN
    v_recommendation := format(
      'Schwächste Dimension: %s (%s/100). Gezielte Übungen mit Eskalations-Szenarien empfohlen.',
      v_weakest_dim, v_weakest_score
    );
  ELSE
    v_recommendation := format(
      'Stabile Gesprächsqualität in %s. Fortgeschrittene Persona-Konflikte einplanen.',
      v_dna.department_name
    );
  END IF;

  RETURN jsonb_build_object(
    'department_key', v_dna.department_key,
    'department_name', v_dna.department_name,
    'category', v_dna.category,
    'window_days', _window_days,
    'signals', jsonb_build_object(
      'sessions_24h', COALESCE(v_signals.sessions_24h, 0),
      'sessions_7d', COALESCE(v_signals.sessions_7d, 0),
      'sessions_30d', COALESCE(v_signals.sessions_30d, 0),
      'avg_escalation', v_signals.avg_escalation,
      'max_escalation', v_signals.max_escalation,
      'high_conflict_pct', v_signals.high_conflict_pct,
      'finalized_sessions', COALESCE(v_signals.finalized_sessions, 0),
      'scores', jsonb_build_object(
        'buergerverstaendlichkeit', v_signals.avg_buergerverstaendlichkeit,
        'deeskalation', v_signals.avg_deeskalation,
        'governance_sicherheit', v_signals.avg_governance_sicherheit,
        'empathie', v_signals.avg_empathie,
        'fachlichkeit', v_signals.avg_fachlichkeit
      ),
      'top_emotions', v_signals.top_emotions,
      'top_personas', v_signals.top_personas
    ),
    'weakest_dimension', jsonb_build_object('label', v_weakest_dim, 'score', v_weakest_score),
    'kpis', v_dna.kpis,
    'risks', v_dna.risks,
    'communication_patterns', v_dna.communication_patterns,
    'escalation_paths', v_dna.escalation_paths,
    'recommendation', v_recommendation,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_daily_brief_department(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verwaltung_daily_brief_department(text, integer) TO authenticated, service_role;

-- ----- RPC: Executive Brief (cross-cluster) ---------------------------------
CREATE OR REPLACE FUNCTION public.verwaltung_daily_brief_executive(
  _window_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clusters jsonb;
  v_hotspots jsonb;
  v_totals record;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sysop')) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT
    COALESCE(SUM(s.sessions_7d), 0) AS total_sessions_7d,
    COALESCE(SUM(s.sessions_24h), 0) AS total_sessions_24h,
    ROUND(AVG(s.avg_escalation)::numeric, 2) AS avg_escalation_all,
    ROUND(AVG(s.high_conflict_pct)::numeric, 1) AS avg_high_conflict_pct
    INTO v_totals
  FROM public.v_verwaltung_daily_brief_signals s
  JOIN public.verwaltung_department_dna d ON d.department_key = s.department_key
  WHERE s.sessions_7d > 0;

  SELECT jsonb_agg(row_to_json(c) ORDER BY c.avg_escalation DESC NULLS LAST)
    INTO v_clusters
  FROM (
    SELECT
      d.category,
      COUNT(DISTINCT d.department_key) AS departments_active,
      SUM(s.sessions_7d) AS sessions_7d,
      ROUND(AVG(s.avg_escalation)::numeric, 2) AS avg_escalation,
      ROUND(AVG(s.high_conflict_pct)::numeric, 1) AS high_conflict_pct
    FROM public.verwaltung_department_dna d
    LEFT JOIN public.v_verwaltung_daily_brief_signals s ON s.department_key = d.department_key
    GROUP BY d.category
  ) c;

  SELECT jsonb_agg(row_to_json(h) ORDER BY h.avg_escalation DESC NULLS LAST)
    INTO v_hotspots
  FROM (
    SELECT
      d.department_key,
      d.department_name,
      d.category,
      s.sessions_7d,
      s.avg_escalation,
      s.high_conflict_pct,
      LEAST(
        COALESCE(s.avg_buergerverstaendlichkeit, 100),
        COALESCE(s.avg_deeskalation, 100),
        COALESCE(s.avg_governance_sicherheit, 100)
      ) AS weakest_score
    FROM public.v_verwaltung_daily_brief_signals s
    JOIN public.verwaltung_department_dna d ON d.department_key = s.department_key
    WHERE s.sessions_7d > 0
    ORDER BY s.avg_escalation DESC NULLS LAST, s.high_conflict_pct DESC NULLS LAST
    LIMIT 8
  ) h;

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'totals', jsonb_build_object(
      'sessions_24h', COALESCE(v_totals.total_sessions_24h, 0),
      'sessions_7d', COALESCE(v_totals.total_sessions_7d, 0),
      'avg_escalation', v_totals.avg_escalation_all,
      'avg_high_conflict_pct', v_totals.avg_high_conflict_pct
    ),
    'clusters', COALESCE(v_clusters, '[]'::jsonb),
    'hotspots', COALESCE(v_hotspots, '[]'::jsonb),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_daily_brief_executive(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verwaltung_daily_brief_executive(integer) TO authenticated, service_role;

-- ----- RPC: Governance Risks ------------------------------------------------
CREATE OR REPLACE FUNCTION public.verwaltung_daily_brief_governance_risks(
  _window_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_risks jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sysop')) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT jsonb_agg(row_to_json(r))
    INTO v_risks
  FROM (
    SELECT
      d.department_key,
      d.department_name,
      d.category,
      CASE
        WHEN s.high_conflict_pct >= 50 THEN 'ESKALATIONS_CLUSTER'
        WHEN COALESCE(s.avg_buergerverstaendlichkeit, 100) < 65 THEN 'BUERGERFRUST_RISIKO'
        WHEN COALESCE(s.avg_governance_sicherheit, 100) < 65 THEN 'GOVERNANCE_LUECKE'
        WHEN COALESCE(s.avg_deeskalation, 100) < 65 THEN 'DEESKALATIONS_DEFIZIT'
        WHEN COALESCE(s.avg_empathie, 100) < 65 THEN 'EMPATHIE_DEFIZIT'
        ELSE 'KOMMUNIKATIONS_DRIFT'
      END AS risk_type,
      s.sessions_7d,
      s.avg_escalation,
      s.high_conflict_pct,
      jsonb_build_object(
        'buergerverstaendlichkeit', s.avg_buergerverstaendlichkeit,
        'deeskalation', s.avg_deeskalation,
        'governance_sicherheit', s.avg_governance_sicherheit,
        'empathie', s.avg_empathie
      ) AS scores
    FROM public.v_verwaltung_daily_brief_signals s
    JOIN public.verwaltung_department_dna d ON d.department_key = s.department_key
    WHERE s.sessions_7d > 0
      AND (
        s.high_conflict_pct >= 40
        OR COALESCE(s.avg_buergerverstaendlichkeit, 100) < 70
        OR COALESCE(s.avg_governance_sicherheit, 100) < 70
        OR COALESCE(s.avg_deeskalation, 100) < 70
        OR COALESCE(s.avg_empathie, 100) < 70
      )
    ORDER BY s.high_conflict_pct DESC NULLS LAST, s.avg_escalation DESC NULLS LAST
    LIMIT 20
  ) r;

  RETURN jsonb_build_object(
    'window_days', _window_days,
    'risks', COALESCE(v_risks, '[]'::jsonb),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_daily_brief_governance_risks(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verwaltung_daily_brief_governance_risks(integer) TO authenticated, service_role;
