-- ============================================================
-- HEAL-COCKPIT PATTERN-INTELLIGENZ v1 (fixed)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.heal_pattern_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text NOT NULL,
  cluster text NOT NULL,
  package_id uuid,
  target_id text NOT NULL,
  target_type text,
  recurrence_7d integer NOT NULL DEFAULT 0,
  recurrence_24h integer NOT NULL DEFAULT 0,
  severity_score integer NOT NULL DEFAULT 0,
  root_cause text,
  heal_plan jsonb,
  permanent_fix_suggestion text,
  confidence numeric(4,3),
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','superseded','resolved','dismissed')),
  resolved_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  valid_until timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heal_pattern_recs_pattern_status
  ON public.heal_pattern_recommendations (pattern_key, status, valid_until DESC);
CREATE INDEX IF NOT EXISTS idx_heal_pattern_recs_pkg
  ON public.heal_pattern_recommendations (package_id, status);
CREATE INDEX IF NOT EXISTS idx_heal_pattern_recs_active
  ON public.heal_pattern_recommendations (status, valid_until DESC)
  WHERE status = 'active';

ALTER TABLE public.heal_pattern_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS heal_pattern_recs_admin_select ON public.heal_pattern_recommendations;
CREATE POLICY heal_pattern_recs_admin_select
  ON public.heal_pattern_recommendations
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS heal_pattern_recs_admin_update ON public.heal_pattern_recommendations;
CREATE POLICY heal_pattern_recs_admin_update
  ON public.heal_pattern_recommendations
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS heal_pattern_recs_service_insert ON public.heal_pattern_recommendations;
CREATE POLICY heal_pattern_recs_service_insert
  ON public.heal_pattern_recommendations
  FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.trg_heal_pattern_recs_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heal_pattern_recs_updated_at ON public.heal_pattern_recommendations;
CREATE TRIGGER trg_heal_pattern_recs_updated_at
  BEFORE UPDATE ON public.heal_pattern_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.trg_heal_pattern_recs_updated_at();

-- View: wiederkehrende Pattern
CREATE OR REPLACE VIEW public.v_heal_recurring_patterns
WITH (security_invoker = true) AS
WITH base AS (
  SELECT action_type AS cluster, target_id, target_type, created_at,
         result_status, duration_ms, error_message
  FROM public.auto_heal_log
  WHERE created_at > now() - interval '7 days'
    AND target_id IS NOT NULL
    AND action_type NOT IN (
      'production_guardian_cycle','pipeline_watchdog_cycle','worker_liveness_check',
      'lc_shard_liveness_revive','atomic_step_enqueue','tail_step_retryable_deferred'
    )
),
agg AS (
  SELECT cluster, target_id,
    MAX(target_type) AS target_type,
    COUNT(*) AS recurrence_7d,
    COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS recurrence_24h,
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')   AS recurrence_1h,
    COUNT(*) FILTER (WHERE result_status = 'failed' AND created_at > now() - interval '24 hours') AS failed_24h,
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen,
    MODE() WITHIN GROUP (ORDER BY error_message) AS dominant_error
  FROM base
  GROUP BY cluster, target_id
  HAVING COUNT(*) >= 3
),
scored AS (
  SELECT a.*,
    LEAST(100, ROUND(
      (a.recurrence_7d::numeric / 50.0) * 30 +
      (a.recurrence_24h::numeric / 20.0) * 30 +
      (CASE WHEN a.recurrence_1h >= 5 THEN 25 ELSE (a.recurrence_1h * 5)::numeric END) +
      (CASE WHEN a.cluster IN (
        'enqueue_phantom_blocked','requeue_loop_mitigation','hot_loop_mitigation',
        'stale_lock_hard_kill','zombie_detected_hard_stalled'
      ) THEN 15 ELSE 0 END)
    )::int) AS severity_score,
    CASE WHEN a.recurrence_7d > 0
      THEN ROUND((a.recurrence_24h::numeric / a.recurrence_7d) * 100, 1)
      ELSE 0::numeric END AS escalation_rate_pct,
    encode(digest(a.cluster || '|' || a.target_id, 'sha1'), 'hex') AS pattern_key,
    CASE WHEN a.target_id ~ '^[0-9a-f-]{36}$' THEN a.target_id::uuid ELSE NULL END AS package_id_uuid
  FROM agg a
)
SELECT
  s.pattern_key, s.cluster, s.target_id, s.target_type,
  s.package_id_uuid AS package_id,
  cp.title AS package_title, cp.status AS package_status, cp.track AS package_track,
  cp.blocked_reason, cp.last_error AS package_last_error,
  s.recurrence_7d, s.recurrence_24h, s.recurrence_1h, s.failed_24h,
  s.severity_score, s.escalation_rate_pct,
  s.first_seen, s.last_seen, s.dominant_error,
  rec.id        AS active_recommendation_id,
  rec.confidence AS recommendation_confidence,
  rec.root_cause AS recommendation_root_cause,
  rec.permanent_fix_suggestion AS recommendation_permanent_fix,
  rec.created_at AS recommendation_created_at,
  rec.valid_until AS recommendation_valid_until
FROM scored s
LEFT JOIN public.course_packages cp ON cp.id = s.package_id_uuid
LEFT JOIN LATERAL (
  SELECT id, confidence, root_cause, permanent_fix_suggestion, created_at, valid_until
  FROM public.heal_pattern_recommendations r
  WHERE r.pattern_key = s.pattern_key
    AND r.status = 'active'
    AND r.valid_until > now()
  ORDER BY r.created_at DESC LIMIT 1
) rec ON true
ORDER BY s.severity_score DESC, s.recurrence_24h DESC;

-- View: KPI 24h
CREATE OR REPLACE VIEW public.v_heal_kpi_overview
WITH (security_invoker = true) AS
WITH window24 AS (
  SELECT action_type, result_status, duration_ms, trigger_source, created_at
  FROM public.auto_heal_log
  WHERE created_at > now() - interval '24 hours'
),
totals AS (
  SELECT
    COUNT(*) AS total_events_24h,
    COUNT(*) FILTER (WHERE result_status = 'success') AS success_24h,
    COUNT(*) FILTER (WHERE result_status = 'failed')  AS failed_24h,
    COUNT(*) FILTER (WHERE result_status = 'skipped') AS skipped_24h,
    COUNT(*) FILTER (WHERE trigger_source IN ('cron','auto','system'))  AS auto_24h,
    COUNT(*) FILTER (WHERE trigger_source IN ('admin','manual','user')) AS manual_24h,
    AVG(duration_ms) FILTER (WHERE result_status = 'success' AND duration_ms IS NOT NULL) AS avg_duration_ms
  FROM window24
),
top_clusters AS (
  SELECT jsonb_agg(j ORDER BY cnt DESC) AS top_3
  FROM (
    SELECT jsonb_build_object('cluster', action_type, 'count', cnt) AS j, cnt
    FROM (
      SELECT action_type, COUNT(*) AS cnt
      FROM window24
      WHERE action_type NOT IN (
        'production_guardian_cycle','pipeline_watchdog_cycle','worker_liveness_check',
        'lc_shard_liveness_revive','atomic_step_enqueue'
      )
      GROUP BY action_type ORDER BY cnt DESC LIMIT 3
    ) t
  ) x
),
patterns AS (
  SELECT
    COUNT(*) AS active_pattern_count,
    COUNT(*) FILTER (WHERE severity_score >= 60) AS high_severity_count,
    COUNT(*) FILTER (WHERE escalation_rate_pct > 60) AS escalating_count
  FROM public.v_heal_recurring_patterns
)
SELECT
  t.total_events_24h, t.success_24h, t.failed_24h, t.skipped_24h, t.auto_24h, t.manual_24h,
  CASE WHEN t.total_events_24h > 0
    THEN ROUND((t.success_24h::numeric / t.total_events_24h) * 100, 1) ELSE 0 END AS success_rate_pct,
  CASE WHEN (t.auto_24h + t.manual_24h) > 0
    THEN ROUND((t.auto_24h::numeric / (t.auto_24h + t.manual_24h)) * 100, 1) ELSE 0 END AS auto_heal_quote_pct,
  COALESCE(ROUND(t.avg_duration_ms::numeric, 0), 0) AS avg_duration_ms,
  COALESCE(tc.top_3, '[]'::jsonb) AS top_clusters_24h,
  p.active_pattern_count, p.high_severity_count, p.escalating_count,
  now() AS computed_at
FROM totals t CROSS JOIN top_clusters tc CROSS JOIN patterns p;

-- View: Root-Cause-Signale
CREATE OR REPLACE VIEW public.v_heal_pattern_root_cause_signals
WITH (security_invoker = true) AS
SELECT
  p.pattern_key, p.cluster, p.package_id, p.package_title, p.package_status, p.package_track,
  p.blocked_reason, p.package_last_error, p.severity_score,
  p.recurrence_24h, p.recurrence_7d, p.escalation_rate_pct, p.dominant_error,
  (SELECT jsonb_agg(jsonb_build_object(
      'action', action_type, 'status', result_status,
      'detail', LEFT(COALESCE(result_detail, error_message, ''), 240),
      'at', created_at
    ) ORDER BY created_at DESC)
   FROM (
     SELECT action_type, result_status, result_detail, error_message, created_at
     FROM public.auto_heal_log
     WHERE target_id = p.target_id
     ORDER BY created_at DESC LIMIT 5
   ) recent
  ) AS recent_heal_attempts,
  (SELECT jsonb_agg(DISTINCT jsonb_build_object('step_key', step_key, 'status', status))
   FROM public.package_steps
   WHERE package_id = p.package_id
     AND status IN ('failed','blocked')
  ) AS failed_steps
FROM public.v_heal_recurring_patterns p;

-- RPC: Next Best Action
CREATE OR REPLACE FUNCTION public.admin_heal_next_best_action(p_limit integer DEFAULT 12)
RETURNS TABLE (
  pattern_key text, cluster text, package_id uuid, package_title text, package_status text,
  severity_score integer, recurrence_24h integer, escalation_rate_pct numeric,
  blocked_reason text, package_last_error text, dominant_error text,
  active_recommendation_id uuid, recommendation_confidence numeric,
  recommendation_root_cause text, recommendation_permanent_fix text,
  has_active_recommendation boolean, prior_heal_attempts integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN QUERY
  SELECT v.pattern_key, v.cluster, v.package_id, v.package_title, v.package_status,
    v.severity_score, v.recurrence_24h, v.escalation_rate_pct,
    v.blocked_reason, v.package_last_error, v.dominant_error,
    v.active_recommendation_id, v.recommendation_confidence,
    v.recommendation_root_cause, v.recommendation_permanent_fix,
    (v.active_recommendation_id IS NOT NULL) AS has_active_recommendation,
    COALESCE((
      SELECT COUNT(*)::int FROM public.auto_heal_log h
      WHERE h.target_id = v.target_id AND h.created_at > now() - interval '7 days'
    ), 0) AS prior_heal_attempts
  FROM public.v_heal_recurring_patterns v
  ORDER BY v.severity_score DESC, v.escalation_rate_pct DESC, v.recurrence_24h DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_heal_next_best_action(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_heal_next_best_action(integer) TO authenticated;

-- RPC: mark resolved
CREATE OR REPLACE FUNCTION public.admin_heal_pattern_mark_resolved(p_pattern_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.heal_pattern_recommendations%ROWTYPE;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.heal_pattern_recommendations
     SET status = 'resolved', resolved_note = p_note, resolved_by = v_uid, resolved_at = now()
   WHERE id = p_pattern_id AND status = 'active'
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found_or_not_active'); END IF;
  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('heal_pattern_marked_resolved', 'admin', v_row.target_id, COALESCE(v_row.target_type, 'pattern'),
    'success', COALESCE(p_note, 'manually marked resolved'),
    jsonb_build_object('pattern_id', v_row.id, 'cluster', v_row.cluster, 'admin_uid', v_uid));
  RETURN jsonb_build_object('ok', true, 'pattern_id', v_row.id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_heal_pattern_mark_resolved(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_heal_pattern_mark_resolved(uuid, text) TO authenticated;

-- RPC: dismiss
CREATE OR REPLACE FUNCTION public.admin_heal_pattern_dismiss(p_pattern_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.heal_pattern_recommendations%ROWTYPE;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.heal_pattern_recommendations
     SET status = 'dismissed', resolved_note = p_reason, resolved_by = v_uid, resolved_at = now()
   WHERE id = p_pattern_id AND status = 'active'
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found_or_not_active'); END IF;
  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('heal_pattern_dismissed', 'admin', v_row.target_id, COALESCE(v_row.target_type, 'pattern'),
    'success', COALESCE(p_reason, 'manually dismissed'),
    jsonb_build_object('pattern_id', v_row.id, 'cluster', v_row.cluster, 'admin_uid', v_uid));
  RETURN jsonb_build_object('ok', true, 'pattern_id', v_row.id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_heal_pattern_dismiss(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_heal_pattern_dismiss(uuid, text) TO authenticated;

-- RPC: signal bundle
CREATE OR REPLACE FUNCTION public.admin_heal_pattern_signal_bundle(p_pattern_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payload jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT to_jsonb(s.*) INTO v_payload
  FROM public.v_heal_pattern_root_cause_signals s
  WHERE s.pattern_key = p_pattern_key LIMIT 1;
  RETURN COALESCE(v_payload, jsonb_build_object('error','pattern_not_found'));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_heal_pattern_signal_bundle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_heal_pattern_signal_bundle(text) TO authenticated;