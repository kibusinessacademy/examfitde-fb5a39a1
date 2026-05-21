
-- ============================================================
-- Runtime Command Center Observability v1.1
-- Phase 1: Ledger SSOT View
-- Phase 3: Detail/History/Evidence RPCs
-- Phase 5: Risk & Governance metadata on runtime_safe_actions
-- ============================================================

-- Phase 5: Governance metadata (additive, nullable, defaults safe)
ALTER TABLE public.runtime_safe_actions
  ADD COLUMN IF NOT EXISTS risk_level text
    DEFAULT 'MEDIUM'
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS requires_second_confirm boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollback_supported boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dangerous_action boolean NOT NULL DEFAULT false;

-- Seed risk levels per handler matrix
UPDATE public.runtime_safe_actions SET risk_level='LOW',      rollback_supported=false WHERE action_key='open_evidence_chain';
UPDATE public.runtime_safe_actions SET risk_level='LOW'       WHERE action_key='re_run_eval_window';
UPDATE public.runtime_safe_actions SET risk_level='MEDIUM'    WHERE action_key='recompute_sequence';
UPDATE public.runtime_safe_actions SET risk_level='MEDIUM'    WHERE action_key='silence_alert';
UPDATE public.runtime_safe_actions SET risk_level='MEDIUM'    WHERE action_key='trigger_intervention_recheck';
UPDATE public.runtime_safe_actions SET risk_level='HIGH', requires_second_confirm=true, rollback_supported=true, dangerous_action=true WHERE action_key='rollback_policy';
UPDATE public.runtime_safe_actions SET risk_level='HIGH', requires_second_confirm=true, dangerous_action=true WHERE action_key='freeze_policy';
UPDATE public.runtime_safe_actions SET risk_level='HIGH', requires_second_confirm=true, dangerous_action=true WHERE action_key='disable_dataset';

-- ============================================================
-- Phase 1: SSOT Ledger View (append-only, derived)
-- ============================================================
DROP VIEW IF EXISTS public.v_runtime_action_history CASCADE;
CREATE VIEW public.v_runtime_action_history AS
SELECT
  r.id                                              AS runtime_action_id,
  r.created_at,
  r.completed_at,
  r.actor_uid                                       AS operator,
  r.action_key                                      AS action_type,
  rsa.target_layer                                  AS target_type,
  COALESCE(r.payload->>'target_id',
           r.payload->>'package_id',
           r.payload->>'policy_key',
           r.payload->>'dataset_id',
           r.payload->>'alert_key')                 AS target_id,
  r.status,
  COALESCE(rsa.risk_level, 'MEDIUM')                AS risk_level,
  COALESCE(rsa.requires_second_confirm, false)      AS requires_second_confirm,
  COALESCE(rsa.rollback_supported, false)           AS rollback_supported,
  COALESCE(rsa.dangerous_action, false)             AS dangerous_action,
  r.idempotency_key,
  r.duration_ms,
  CASE WHEN r.status IN ('failed') AND r.error ILIKE '%validate%' THEN 'failed'
       WHEN r.status IN ('completed','running','rolled_back') THEN 'passed'
       ELSE 'unknown' END                           AS validation_status,
  CASE WHEN r.status IN ('completed','rolled_back') THEN 'success'
       WHEN r.status='failed' THEN 'failed'
       WHEN r.status='cancelled' THEN 'cancelled'
       WHEN r.status IN ('pending','running') THEN 'in_progress'
       ELSE 'unknown' END                           AS execution_status,
  (r.rollback_ref IS NOT NULL)                      AS rollback_available,
  r.rollback_ref,
  r.id                                              AS evidence_chain_id,
  COALESCE(pg_column_size(r.before_snapshot), 0)    AS snapshot_size_before,
  COALESCE(pg_column_size(r.after_snapshot), 0)     AS snapshot_size_after,
  COALESCE(jsonb_array_length(COALESCE(r.outcome->'mutations','[]'::jsonb)), 0) AS mutation_count,
  COALESCE(jsonb_array_length(COALESCE(r.outcome->'warnings','[]'::jsonb)), 0)  AS warning_count,
  CASE WHEN r.status='failed' THEN 1 ELSE 0 END     AS error_count,
  NULLIF(r.outcome->>'guard_fail_reason','')        AS guard_fail_reason,
  COALESCE(r.outcome->>'summary',
           r.outcome->>'message',
           CASE WHEN r.status='failed' THEN r.error ELSE NULL END) AS result_summary,
  r.reason,
  r.severity,
  r.payload
FROM public.runtime_action_results r
LEFT JOIN public.runtime_safe_actions rsa ON rsa.action_key = r.action_key;

REVOKE ALL ON public.v_runtime_action_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_runtime_action_history TO service_role;

-- ============================================================
-- Phase 3: RPCs (SECURITY DEFINER + has_role gate, admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_runtime_action_history(
  _limit int DEFAULT 100,
  _status_filter text DEFAULT NULL,
  _risk_filter text DEFAULT NULL,
  _action_filter text DEFAULT NULL,
  _search text DEFAULT NULL
)
RETURNS SETOF public.v_runtime_action_history
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.v_runtime_action_history v
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (_status_filter IS NULL OR v.status = _status_filter)
    AND (_risk_filter IS NULL OR v.risk_level = _risk_filter)
    AND (_action_filter IS NULL OR v.action_type = _action_filter)
    AND (_search IS NULL OR _search = '' OR
         v.action_type ILIKE '%'||_search||'%' OR
         COALESCE(v.target_id,'') ILIKE '%'||_search||'%' OR
         COALESCE(v.result_summary,'') ILIKE '%'||_search||'%')
  ORDER BY v.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit,100), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_action_history(int,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_action_history(int,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_runtime_action_detail(_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _row record; _result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT r.*, rsa.target_layer, rsa.risk_level, rsa.label, rsa.description,
         rsa.rollback_supported, rsa.requires_second_confirm, rsa.dangerous_action
    INTO _row
    FROM public.runtime_action_results r
    LEFT JOIN public.runtime_safe_actions rsa ON rsa.action_key = r.action_key
   WHERE r.id = _action_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  _result := jsonb_build_object(
    'id', _row.id,
    'action_key', _row.action_key,
    'label', _row.label,
    'description', _row.description,
    'target_layer', _row.target_layer,
    'risk_level', COALESCE(_row.risk_level,'MEDIUM'),
    'status', _row.status,
    'severity', _row.severity,
    'operator', _row.actor_uid,
    'reason', _row.reason,
    'created_at', _row.created_at,
    'completed_at', _row.completed_at,
    'duration_ms', _row.duration_ms,
    'idempotency_key', _row.idempotency_key,
    'payload', _row.payload,
    'before_snapshot', _row.before_snapshot,
    'after_snapshot', _row.after_snapshot,
    'outcome', _row.outcome,
    'error', _row.error,
    'rollback_ref', _row.rollback_ref,
    'rollback_supported', COALESCE(_row.rollback_supported,false),
    'requires_second_confirm', COALESCE(_row.requires_second_confirm,false),
    'dangerous_action', COALESCE(_row.dangerous_action,false)
  );
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_action_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_action_detail(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_runtime_evidence_chain(_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _action record;
  _evidence jsonb;
  _audit jsonb;
  _target_id text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _action FROM public.runtime_action_results WHERE id=_action_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;

  _target_id := COALESCE(_action.payload->>'target_id',
                         _action.payload->>'package_id',
                         _action.payload->>'policy_key',
                         _action.payload->>'dataset_id',
                         _action.payload->>'alert_key');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id, 'kind', e.evidence_kind, 'ref_table', e.ref_table,
    'ref_id', e.ref_id, 'summary', e.summary, 'created_at', e.created_at
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO _evidence FROM public.runtime_action_evidence e WHERE e.result_id=_action_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'action_type', a.action_type, 'target_type', a.target_type,
    'target_id', a.target_id, 'result_status', a.result_status,
    'created_at', a.created_at, 'duration_ms', a.duration_ms,
    'error_message', a.error_message
  ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO _audit FROM (
    SELECT * FROM public.auto_heal_log
     WHERE (target_id = _action_id::text OR target_id = _target_id
            OR metadata->>'result_id' = _action_id::text)
       AND created_at >= _action.created_at - interval '5 minutes'
       AND created_at <= COALESCE(_action.completed_at, now()) + interval '30 minutes'
     ORDER BY created_at DESC LIMIT 100
  ) a;

  RETURN jsonb_build_object(
    'action_id', _action_id,
    'action_key', _action.action_key,
    'status', _action.status,
    'created_at', _action.created_at,
    'completed_at', _action.completed_at,
    'evidence', _evidence,
    'audit_trail', _audit,
    'before_snapshot', _action.before_snapshot,
    'after_snapshot', _action.after_snapshot,
    'outcome', _action.outcome
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_evidence_chain(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_evidence_chain(uuid) TO authenticated;

-- ============================================================
-- Phase 4 (Failures): Summary RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_runtime_action_failures(_window_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  WITH base AS (
    SELECT * FROM public.v_runtime_action_history
     WHERE created_at >= now() - make_interval(hours => GREATEST(_window_hours,1))
  )
  SELECT jsonb_build_object(
    'window_hours', _window_hours,
    'total', (SELECT count(*) FROM base),
    'by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM base GROUP BY status) s), '{}'::jsonb),
    'by_risk',   COALESCE((SELECT jsonb_object_agg(risk_level, n) FROM (SELECT risk_level, count(*) n FROM base GROUP BY risk_level) r), '{}'::jsonb),
    'top_failing_handlers', COALESCE((SELECT jsonb_agg(jsonb_build_object('action_type',action_type,'count',n))
                                        FROM (SELECT action_type, count(*) n FROM base WHERE status='failed' GROUP BY action_type ORDER BY n DESC LIMIT 5) f), '[]'::jsonb),
    'idempotent_hits', (SELECT count(*) FROM base WHERE idempotency_key IS NOT NULL)
  ) INTO _result;
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_action_failures(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_action_failures(int) TO authenticated;
