
-- =========================================================
-- VerwaltungsOS Cut A5 — Operations Outcome Loop
-- =========================================================

CREATE TABLE IF NOT EXISTS public.verwaltung_modernization_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.verwaltung_agent_workflows(id) ON DELETE CASCADE,
  department_key text NOT NULL,
  workflow_key text NOT NULL,
  snapshot_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  opportunity_score int NOT NULL,
  classification text NOT NULL,
  oral_activity_30d int NOT NULL DEFAULT 0,
  refusal_rate_30d numeric(5,4) NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT verwaltung_modernization_snapshots_unique UNIQUE (workflow_id, snapshot_date),
  CONSTRAINT vms_classification_chk CHECK (classification IN ('HIGH_OPPORTUNITY','MEDIUM_OPPORTUNITY','LOW_OPPORTUNITY','OK'))
);

GRANT ALL ON public.verwaltung_modernization_snapshots TO service_role;

ALTER TABLE public.verwaltung_modernization_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vms admin read"
  ON public.verwaltung_modernization_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "vms service write"
  ON public.verwaltung_modernization_snapshots
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_vms_workflow_date
  ON public.verwaltung_modernization_snapshots(workflow_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_vms_dept_date
  ON public.verwaltung_modernization_snapshots(department_key, snapshot_date DESC);

-- =========================================================
-- RPC: capture snapshot (admin-gated, idempotent per UTC day)
-- =========================================================
CREATE OR REPLACE FUNCTION public.verwaltung_capture_modernization_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_snapshot_date date := (now() AT TIME ZONE 'utc')::date;
  v_inserted int := 0;
  v_updated int := 0;
BEGIN
  v_caller_role := CASE
    WHEN auth.role() = 'service_role' THEN 'service_role'
    WHEN auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin') THEN 'admin'
    ELSE NULL
  END;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  WITH src AS (
    SELECT
      o.workflow_id,
      o.department_key,
      o.workflow_key,
      o.opportunity_score,
      o.classification,
      -- Oral-Aktivität als Department-Level-Proxy (workflow_key↔oral_case_key Mapping fehlt)
      COALESCE((
        SELECT count(*) FROM public.verwaltung_oral_sessions s
         WHERE s.department_key = o.department_key
           AND s.started_at >= now() - interval '30 days'
      ), 0)::int AS oral_activity_30d,
      COALESCE((
        SELECT round(
          (count(*) FILTER (WHERE (t.evaluation->>'is_refusal')::boolean = true))::numeric
          / NULLIF(count(*),0), 4)
          FROM public.verwaltung_oral_turns t
          JOIN public.verwaltung_oral_sessions s ON s.id = t.session_id
         WHERE s.department_key = o.department_key
           AND t.role = 'persona'
           AND t.created_at >= now() - interval '30 days'
      ), 0)::numeric(5,4) AS refusal_rate_30d
    FROM public.v_verwaltung_modernization_opportunities o
  ),
  ins AS (
    INSERT INTO public.verwaltung_modernization_snapshots
      (workflow_id, department_key, workflow_key, snapshot_date,
       opportunity_score, classification, oral_activity_30d, refusal_rate_30d)
    SELECT
      workflow_id, department_key, workflow_key, v_snapshot_date,
      opportunity_score, classification, oral_activity_30d, refusal_rate_30d
    FROM src
    ON CONFLICT (workflow_id, snapshot_date) DO UPDATE
      SET opportunity_score = EXCLUDED.opportunity_score,
          classification    = EXCLUDED.classification,
          oral_activity_30d = EXCLUDED.oral_activity_30d,
          refusal_rate_30d  = EXCLUDED.refusal_rate_30d,
          captured_at       = now()
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT
    count(*) FILTER (WHERE was_inserted),
    count(*) FILTER (WHERE NOT was_inserted)
  INTO v_inserted, v_updated
  FROM ins;

  PERFORM public.fn_emit_audit(
    _action_type     := 'verwaltung_modernization_snapshot_captured',
    _target_type     := 'system',
    _target_id       := NULL,
    _action_data     := jsonb_build_object(
                         'snapshot_date',  v_snapshot_date,
                         'workflows_captured', (v_inserted + v_updated),
                         'inserted',        v_inserted,
                         'updated',         v_updated,
                         'caller_role',     v_caller_role
                       ),
    _result_status   := 'ok'
  );

  RETURN jsonb_build_object(
    'snapshot_date',       v_snapshot_date,
    'workflows_captured',  v_inserted + v_updated,
    'inserted',            v_inserted,
    'updated',             v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_capture_modernization_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verwaltung_capture_modernization_snapshot() TO authenticated, service_role;

-- =========================================================
-- RPC: outcome-loop reader
-- =========================================================
CREATE OR REPLACE FUNCTION public.verwaltung_workflow_outcome_loop(_lookback_days int DEFAULT 30, _limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_lookback int := GREATEST(7, LEAST(COALESCE(_lookback_days, 30), 180));
  v_limit int := GREATEST(1, LEAST(COALESCE(_limit, 50), 200));
  v_result jsonb;
BEGIN
  v_caller_role := CASE
    WHEN auth.role() = 'service_role' THEN 'service_role'
    WHEN auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin') THEN 'admin'
    ELSE NULL
  END;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (workflow_id) *
      FROM public.verwaltung_modernization_snapshots
     ORDER BY workflow_id, snapshot_date DESC
  ),
  baseline AS (
    SELECT DISTINCT ON (workflow_id) *
      FROM public.verwaltung_modernization_snapshots
     WHERE snapshot_date <= (now() AT TIME ZONE 'utc')::date - v_lookback
     ORDER BY workflow_id, snapshot_date DESC
  ),
  paired AS (
    SELECT
      l.workflow_id,
      l.department_key,
      l.workflow_key,
      l.opportunity_score        AS score_now,
      b.opportunity_score        AS score_baseline,
      l.classification           AS class_now,
      b.classification           AS class_baseline,
      l.oral_activity_30d        AS oral_now,
      COALESCE(b.oral_activity_30d, 0) AS oral_baseline,
      l.refusal_rate_30d         AS refusal_now,
      COALESCE(b.refusal_rate_30d, 0) AS refusal_baseline,
      l.snapshot_date            AS date_now,
      b.snapshot_date            AS date_baseline,
      CASE
        WHEN b.opportunity_score IS NULL                     THEN 'NO_BASELINE'
        WHEN l.opportunity_score - b.opportunity_score <= -5 THEN 'IMPROVED'
        WHEN l.opportunity_score - b.opportunity_score >=  5 THEN 'REGRESSED'
        ELSE 'STABLE'
      END AS outcome_class,
      COALESCE(l.opportunity_score - b.opportunity_score, 0) AS delta_score
    FROM latest l
    LEFT JOIN baseline b ON b.workflow_id = l.workflow_id
    JOIN public.verwaltung_agent_workflows w ON w.id = l.workflow_id
   WHERE w.is_active = true
  ),
  totals AS (
    SELECT
      count(*)::int                                            AS workflows_total,
      count(*) FILTER (WHERE outcome_class = 'IMPROVED')::int  AS improved,
      count(*) FILTER (WHERE outcome_class = 'REGRESSED')::int AS regressed,
      count(*) FILTER (WHERE outcome_class = 'STABLE')::int    AS stable,
      count(*) FILTER (WHERE outcome_class = 'NO_BASELINE')::int AS no_baseline,
      round(avg(delta_score) FILTER (WHERE outcome_class <> 'NO_BASELINE')::numeric, 2) AS avg_delta_score,
      count(DISTINCT department_key)::int                      AS departments
    FROM paired
  ),
  by_dept AS (
    SELECT
      department_key,
      count(*)::int                                            AS workflows_total,
      count(*) FILTER (WHERE outcome_class = 'IMPROVED')::int  AS improved,
      count(*) FILTER (WHERE outcome_class = 'REGRESSED')::int AS regressed,
      count(*) FILTER (WHERE outcome_class = 'STABLE')::int    AS stable,
      count(*) FILTER (WHERE outcome_class = 'NO_BASELINE')::int AS no_baseline,
      round(avg(delta_score) FILTER (WHERE outcome_class <> 'NO_BASELINE')::numeric, 2) AS avg_delta_score
    FROM paired
    GROUP BY department_key
    ORDER BY (count(*) FILTER (WHERE outcome_class = 'REGRESSED')) DESC,
             (count(*) FILTER (WHERE outcome_class = 'IMPROVED'))  DESC
    LIMIT v_limit
  ),
  top_movers AS (
    SELECT *
      FROM paired
     WHERE outcome_class IN ('IMPROVED','REGRESSED')
     ORDER BY abs(delta_score) DESC
     LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'generated_at',   now(),
    'lookback_days',  v_lookback,
    'totals',         (SELECT to_jsonb(t) FROM totals t),
    'by_department',  COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM by_dept b), '[]'::jsonb),
    'top_movers',     COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM top_movers m), '[]'::jsonb)
  )
  INTO v_result;

  PERFORM public.fn_emit_audit(
    _action_type     := 'verwaltung_workflow_outcome_loop_read',
    _target_type     := 'system',
    _target_id       := NULL,
    _action_data     := jsonb_build_object(
                         'lookback_days', v_lookback,
                         'limit',         v_limit,
                         'caller_role',   v_caller_role
                       ),
    _result_status   := 'ok'
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.verwaltung_workflow_outcome_loop(int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verwaltung_workflow_outcome_loop(int,int) TO authenticated, service_role;

-- =========================================================
-- Audit contracts
-- =========================================================
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('verwaltung_modernization_snapshot_captured',
   ARRAY['snapshot_date','workflows_captured','inserted','updated','caller_role'],
   'verwaltungsos'),
  ('verwaltung_workflow_outcome_loop_read',
   ARRAY['lookback_days','limit','caller_role'],
   'verwaltungsos')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module;
