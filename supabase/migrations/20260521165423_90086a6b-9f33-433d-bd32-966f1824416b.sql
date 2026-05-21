-- =====================================================================
-- Runtime Intelligence Layer v1.3
-- Extends v1.0/v1.1/v1.2 with: cascade prevention, historical risk
-- intelligence, advisory recommendations. NO autonomous mutations.
-- =====================================================================

-- 1) Cooldown registry per action_key ---------------------------------
CREATE TABLE IF NOT EXISTS public.runtime_action_cooldowns (
  action_key text PRIMARY KEY
    REFERENCES public.runtime_safe_actions(action_key) ON UPDATE CASCADE ON DELETE CASCADE,
  cooldown_seconds int NOT NULL DEFAULT 60 CHECK (cooldown_seconds BETWEEN 0 AND 86400),
  max_per_hour int NOT NULL DEFAULT 20 CHECK (max_per_hour BETWEEN 1 AND 1000),
  max_concurrent_per_target int NOT NULL DEFAULT 1 CHECK (max_concurrent_per_target BETWEEN 1 AND 100),
  scope text NOT NULL DEFAULT 'per_target' CHECK (scope IN ('global','per_target','per_actor')),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.runtime_action_cooldowns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rac_admin_read ON public.runtime_action_cooldowns;
CREATE POLICY rac_admin_read ON public.runtime_action_cooldowns FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(),'admin'::public.app_role));

INSERT INTO public.runtime_action_cooldowns(action_key, cooldown_seconds, max_per_hour, max_concurrent_per_target, scope, notes)
SELECT a.action_key,
  CASE a.severity WHEN 'critical' THEN 300 WHEN 'high' THEN 120 WHEN 'medium' THEN 60 ELSE 30 END,
  CASE a.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 10 WHEN 'medium' THEN 20 ELSE 60 END,
  CASE WHEN a.is_destructive THEN 1 ELSE 3 END,
  CASE WHEN a.target_layer = 'observability' THEN 'global' ELSE 'per_target' END,
  'seeded defaults v1.3'
FROM public.runtime_safe_actions a
ON CONFLICT (action_key) DO NOTHING;

-- 2) Cooldown state view ---------------------------------------------
CREATE OR REPLACE VIEW public.v_runtime_action_cooldown_state AS
WITH last_runs AS (
  SELECT r.action_key,
         COALESCE(r.payload->>'target_id', '_global_') AS target_id,
         max(r.created_at) FILTER (WHERE r.status IN ('completed','running','pending'))
           AS last_action_at,
         count(*) FILTER (WHERE r.created_at > now() - interval '1 hour'
                          AND r.status NOT IN ('cancelled')) AS last_hour_count,
         count(*) FILTER (WHERE r.status IN ('pending','running')) AS concurrent_count
  FROM public.runtime_action_results r
  WHERE r.simulation_only = false AND r.is_rollback = false
  GROUP BY 1,2
)
SELECT c.action_key, l.target_id,
       c.cooldown_seconds, c.max_per_hour, c.max_concurrent_per_target, c.scope,
       l.last_action_at,
       GREATEST(0, c.cooldown_seconds
         - EXTRACT(EPOCH FROM (now() - COALESCE(l.last_action_at, now() - interval '999 days')))::int
       ) AS retry_after_seconds,
       l.last_hour_count, l.concurrent_count,
       (COALESCE(l.last_hour_count,0) >= c.max_per_hour
        OR COALESCE(l.concurrent_count,0) >= c.max_concurrent_per_target
        OR (l.last_action_at IS NOT NULL
            AND l.last_action_at > now() - make_interval(secs => c.cooldown_seconds))
       ) AS in_cooldown
FROM public.runtime_action_cooldowns c
LEFT JOIN last_runs l USING (action_key);

-- 3) Cooldown-check RPC ----------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_check_runtime_cooldown(
  _action_key text, _target_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record; v_target text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_target := COALESCE(NULLIF(_target_id,''), '_global_');
  SELECT * INTO v_row FROM public.v_runtime_action_cooldown_state
    WHERE action_key = _action_key AND target_id = v_target LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'action_key', _action_key,
      'target_id', v_target, 'retry_after_seconds', 0, 'last_hour_count', 0,
      'concurrent_count', 0, 'reason', 'ok');
  END IF;
  RETURN jsonb_build_object(
    'allowed', NOT v_row.in_cooldown,
    'action_key', _action_key,
    'target_id', v_target,
    'retry_after_seconds', COALESCE(v_row.retry_after_seconds,0),
    'last_hour_count', COALESCE(v_row.last_hour_count,0),
    'concurrent_count', COALESCE(v_row.concurrent_count,0),
    'reason', CASE
      WHEN COALESCE(v_row.concurrent_count,0) >= COALESCE(v_row.max_concurrent_per_target,1)
        THEN 'concurrent_limit_exceeded'
      WHEN COALESCE(v_row.last_hour_count,0) >= COALESCE(v_row.max_per_hour,20)
        THEN 'hourly_rate_limit_exceeded'
      WHEN COALESCE(v_row.retry_after_seconds,0) > 0 THEN 'cooldown_window_active'
      ELSE 'ok' END
  );
END$$;
REVOKE ALL ON FUNCTION public.admin_check_runtime_cooldown(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_check_runtime_cooldown(text,text) TO authenticated;

-- 4) Cascade-prevention trigger --------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_runtime_cooldown()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state record; v_target text;
BEGIN
  IF NEW.simulation_only = true OR NEW.is_rollback = true THEN RETURN NEW; END IF;
  IF NEW.payload ? 'cooldown_override' AND (NEW.payload->>'cooldown_override')::boolean = true THEN
    RETURN NEW;
  END IF;
  v_target := COALESCE(NEW.payload->>'target_id', '_global_');
  SELECT * INTO v_state FROM public.v_runtime_action_cooldown_state
    WHERE action_key = NEW.action_key AND target_id = v_target LIMIT 1;
  IF FOUND AND v_state.in_cooldown THEN
    NEW.status := 'cancelled';
    NEW.completed_at := now();
    NEW.error := 'cooldown_blocked';
    NEW.outcome := jsonb_build_object(
      'cooldown_blocked', true,
      'retry_after_seconds', v_state.retry_after_seconds,
      'last_hour_count', v_state.last_hour_count,
      'concurrent_count', v_state.concurrent_count
    );
    BEGIN
      PERFORM public.fn_emit_audit(
        _action_type := 'runtime_safe_action_cooldown_blocked',
        _target_type := 'system', _target_id := NEW.action_key,
        _result_status := 'blocked',
        _payload := NEW.outcome || jsonb_build_object('action_key', NEW.action_key, 'target_id', v_target),
        _trigger_source := 'runtime_intelligence_v1_3'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_guard_runtime_cooldown ON public.runtime_action_results;
CREATE TRIGGER trg_guard_runtime_cooldown
  BEFORE INSERT ON public.runtime_action_results
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_runtime_cooldown();

-- 5) Intelligence aggregate view -------------------------------------
CREATE OR REPLACE VIEW public.v_runtime_action_intelligence AS
WITH base AS (
  SELECT r.action_key,
    count(*) FILTER (WHERE r.created_at > now() - interval '30 days') AS runs_30d,
    count(*) FILTER (WHERE r.created_at > now() - interval '24 hours') AS runs_24h,
    count(*) FILTER (WHERE r.status='completed' AND r.created_at > now() - interval '30 days') AS success_30d,
    count(*) FILTER (WHERE r.status='failed' AND r.created_at > now() - interval '30 days') AS failed_30d,
    count(*) FILTER (WHERE r.status='rolled_back' AND r.created_at > now() - interval '30 days') AS rolled_back_30d,
    count(*) FILTER (WHERE r.status='cancelled' AND r.error='cooldown_blocked'
                     AND r.created_at > now() - interval '7 days') AS cooldown_blocks_7d,
    avg(r.duration_ms) FILTER (WHERE r.status='completed' AND r.created_at > now() - interval '30 days') AS avg_duration_ms,
    max(r.created_at) FILTER (WHERE r.status='failed') AS last_failure_at,
    max(r.created_at) FILTER (WHERE r.status='completed') AS last_success_at
  FROM public.runtime_action_results r
  WHERE r.simulation_only = false
  GROUP BY r.action_key
),
failure_reasons AS (
  SELECT action_key,
         jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC) AS top
  FROM (
    SELECT action_key,
           COALESCE(NULLIF(left(error, 80),''), 'unknown') AS reason,
           count(*) AS cnt
    FROM public.runtime_action_results
    WHERE status='failed' AND created_at > now() - interval '30 days'
    GROUP BY action_key, COALESCE(NULLIF(left(error, 80),''), 'unknown')
  ) r
  GROUP BY action_key
)
SELECT a.action_key, a.severity, a.target_layer, a.is_destructive, a.is_enabled,
       COALESCE(b.runs_30d,0) AS runs_30d, COALESCE(b.runs_24h,0) AS runs_24h,
       COALESCE(b.success_30d,0) AS success_30d, COALESCE(b.failed_30d,0) AS failed_30d,
       COALESCE(b.rolled_back_30d,0) AS rolled_back_30d,
       COALESCE(b.cooldown_blocks_7d,0) AS cooldown_blocks_7d,
       CASE WHEN COALESCE(b.runs_30d,0) > 0
            THEN round(100.0 * b.failed_30d / NULLIF(b.runs_30d,0), 1) ELSE 0 END AS failure_rate_pct,
       CASE WHEN COALESCE(b.success_30d,0) > 0
            THEN round(100.0 * b.rolled_back_30d / NULLIF(b.success_30d,0), 1) ELSE 0 END AS rollback_rate_pct,
       b.avg_duration_ms, b.last_failure_at, b.last_success_at,
       COALESCE(fr.top, '[]'::jsonb) AS top_failure_reasons,
       c.cooldown_seconds, c.max_per_hour, c.max_concurrent_per_target
FROM public.runtime_safe_actions a
LEFT JOIN base b USING (action_key)
LEFT JOIN failure_reasons fr USING (action_key)
LEFT JOIN public.runtime_action_cooldowns c USING (action_key);

-- 6) Cascade pattern detection ---------------------------------------
CREATE OR REPLACE VIEW public.v_runtime_action_cascade_pattern AS
WITH seq AS (
  SELECT r.action_key AS a, r.created_at AS a_ts,
         lead(r.action_key) OVER (ORDER BY r.created_at) AS b,
         lead(r.created_at) OVER (ORDER BY r.created_at) AS b_ts
  FROM public.runtime_action_results r
  WHERE r.simulation_only = false AND r.is_rollback = false
    AND r.created_at > now() - interval '30 days'
)
SELECT a AS action_a, b AS action_b, count(*) AS occurrences,
       avg(EXTRACT(EPOCH FROM (b_ts - a_ts)))::int AS avg_gap_seconds
FROM seq
WHERE b IS NOT NULL AND b_ts <= a_ts + interval '5 minutes' AND a <> b
GROUP BY a, b
HAVING count(*) >= 2;

-- 7) Recommendations RPC ---------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_runtime_recommendations()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind','high_failure_rate','severity','warning',
      'action_key', action_key,
      'message', format('%s hat %s%% Fehlerquote (30d, %s Runs)', action_key, failure_rate_pct, runs_30d),
      'suggestion','Vor erneuter Ausfuehrung Dry-Run + Evidence-Chain pruefen.',
      'evidence', jsonb_build_object('failure_rate_pct',failure_rate_pct,'runs_30d',runs_30d,'top_reasons',top_failure_reasons)
    ))
    FROM public.v_runtime_action_intelligence
    WHERE runs_30d >= 5 AND failure_rate_pct >= 25
  ), '[]'::jsonb);

  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind','cascade_pattern','severity','info',
      'action_key', action_a,
      'message', format('%s folgt %sx innerhalb von %ss auf %s', action_b, occurrences, avg_gap_seconds, action_a),
      'suggestion','Pattern auf gemeinsamen Root-Cause pruefen oder Cooldown erhoehen.',
      'evidence', jsonb_build_object('action_b',action_b,'occurrences',occurrences,'avg_gap_seconds',avg_gap_seconds)
    ))
    FROM public.v_runtime_action_cascade_pattern
    WHERE occurrences >= 3
  ), '[]'::jsonb);

  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind','cooldown_pressure','severity','warning',
      'action_key', action_key,
      'message', format('%s wurde %sx in 7d vom Cooldown blockiert', action_key, cooldown_blocks_7d),
      'suggestion','Root-Cause klaeren oder max_per_hour anpassen.',
      'evidence', jsonb_build_object('cooldown_blocks_7d',cooldown_blocks_7d)
    ))
    FROM public.v_runtime_action_intelligence
    WHERE cooldown_blocks_7d >= 3
  ), '[]'::jsonb);

  v_out := v_out || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind','heal_pattern_link','severity','info',
      'action_key', NULL,
      'message', format('Heal-Pattern %s (severity %s) aktiv', cluster, severity_score),
      'suggestion', COALESCE(permanent_fix_suggestion, root_cause, 'Heal-Pattern-Card konsultieren'),
      'evidence', jsonb_build_object('pattern_key',pattern_key,'cluster',cluster,'severity',severity_score,'confidence',confidence)
    ))
    FROM public.heal_pattern_recommendations
    WHERE status='active' AND severity_score >= 60
    ORDER BY severity_score DESC LIMIT 10
  ), '[]'::jsonb);

  RETURN v_out;
END$$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_recommendations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_recommendations() TO authenticated;

-- 8) Intelligence + cascade RPCs -------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_runtime_intelligence()
RETURNS SETOF public.v_runtime_action_intelligence
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.v_runtime_action_intelligence
    ORDER BY failure_rate_pct DESC NULLS LAST, runs_30d DESC;
END$$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_intelligence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_intelligence() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_runtime_cascade_patterns()
RETURNS SETOF public.v_runtime_action_cascade_pattern
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.v_runtime_action_cascade_pattern
    ORDER BY occurrences DESC;
END$$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_cascade_patterns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_cascade_patterns() TO authenticated;

-- 9) Lock view permissions -------------------------------------------
REVOKE ALL ON public.v_runtime_action_intelligence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_runtime_action_cascade_pattern FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_runtime_action_cooldown_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_runtime_action_intelligence TO service_role;
GRANT SELECT ON public.v_runtime_action_cascade_pattern TO service_role;
GRANT SELECT ON public.v_runtime_action_cooldown_state TO service_role;

-- 10) Audit contract -------------------------------------------------
INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES
  ('runtime_safe_action_cooldown_blocked',
   ARRAY['action_key','target_id','retry_after_seconds'],
   'runtime_intelligence_v1_3')
ON CONFLICT (action_type) DO NOTHING;