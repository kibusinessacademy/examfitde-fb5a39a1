
-- ============================================================
-- P1 HARDENING: RPCs with internal cooldown, remediation tracking, enriched incidents
-- ============================================================

-- 1. Create audit_remediation_actions table
CREATE TABLE IF NOT EXISTS public.audit_remediation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.nightly_audit_runs(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  action_key text NOT NULL,
  entity_type text,
  entity_id text,
  status text NOT NULL DEFAULT 'attempted',
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  cooldown_key text NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  outcome_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_remediation_actions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_remediation_cooldown ON public.audit_remediation_actions (cooldown_key, created_at DESC);
CREATE INDEX idx_remediation_run ON public.audit_remediation_actions (run_id);
CREATE INDEX idx_remediation_entity ON public.audit_remediation_actions (entity_type, entity_id);

-- 2. check_heal_cooldown function
CREATE OR REPLACE FUNCTION public.check_heal_cooldown(
  p_cooldown_key text,
  p_cooldown_hours integer DEFAULT 6
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.audit_remediation_actions
    WHERE cooldown_key = p_cooldown_key
      AND status IN ('attempted', 'succeeded')
      AND created_at > now() - make_interval(hours => p_cooldown_hours)
  );
$$;

-- 3. release_stale_leases_safely RPC with internal cooldown
CREATE OR REPLACE FUNCTION public.release_stale_leases_safely(
  p_run_id uuid DEFAULT NULL,
  p_grace_minutes integer DEFAULT 15,
  p_max_per_run integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released integer := 0;
  v_skipped integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT id, job_type
    FROM public.job_queue
    WHERE status = 'processing'
      AND locked_by IS NOT NULL
      AND started_at < now() - make_interval(mins => p_grace_minutes)
      AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '10 minutes')
      AND (updated_at < now() - interval '5 minutes')
    ORDER BY started_at ASC
    LIMIT p_max_per_run
  LOOP
    -- Internal cooldown: skip if already healed within 2h
    IF NOT public.check_heal_cooldown(
      'release_stale_lease:' || rec.id::text, 2
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.job_queue
    SET status = 'pending',
        locked_by = NULL,
        started_at = NULL,
        heartbeat_at = NULL,
        updated_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'stale_lease_released_at', now(),
          'stale_lease_released_by', 'rpc'
        )
    WHERE id = rec.id
      AND status = 'processing';

    -- Log remediation action
    INSERT INTO public.audit_remediation_actions
      (run_id, module_key, action_key, entity_type, entity_id, status, cooldown_key, outcome_code, reason)
    VALUES
      (p_run_id, 'stale_leases', 'release_stale_lease', 'job', rec.id::text,
       'succeeded', 'release_stale_lease:' || rec.id::text, 'released',
       format('Job %s (%s) lease released after grace window', rec.id, rec.job_type));

    v_released := v_released + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'released', v_released,
    'skipped_cooldown', v_skipped
  );
END;
$$;

-- 4. mark_ancient_pending_safely RPC with internal cooldown
CREATE OR REPLACE FUNCTION public.mark_ancient_pending_safely(
  p_run_id uuid DEFAULT NULL,
  p_max_age_hours integer DEFAULT 72,
  p_max_per_run integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled integer := 0;
  v_skipped integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT id, job_type
    FROM public.job_queue
    WHERE status = 'pending'
      AND created_at < now() - make_interval(hours => p_max_age_hours)
    ORDER BY created_at ASC
    LIMIT p_max_per_run
  LOOP
    IF NOT public.check_heal_cooldown(
      'mark_ancient_pending:' || rec.id::text, 12
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.job_queue
    SET status = 'cancelled',
        updated_at = now(),
        last_error = 'Cancelled by nightly audit: ancient pending (' || p_max_age_hours || 'h)',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cancelled_reason', 'ancient_pending',
          'cancelled_at', now(),
          'cancelled_by', 'rpc'
        )
    WHERE id = rec.id
      AND status = 'pending';

    INSERT INTO public.audit_remediation_actions
      (run_id, module_key, action_key, entity_type, entity_id, status, cooldown_key, outcome_code, reason)
    VALUES
      (p_run_id, 'ancient_pending', 'mark_ancient_pending', 'job', rec.id::text,
       'succeeded', 'mark_ancient_pending:' || rec.id::text, 'cancelled',
       format('Job %s (%s) cancelled after %sh pending', rec.id, rec.job_type, p_max_age_hours));

    v_cancelled := v_cancelled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'cancelled', v_cancelled,
    'skipped_cooldown', v_skipped
  );
END;
$$;

-- 5. requeue_integrity_mismatch_safely RPC with internal cooldown
CREATE OR REPLACE FUNCTION public.requeue_integrity_mismatch_safely(
  p_run_id uuid DEFAULT NULL,
  p_package_id uuid DEFAULT NULL,
  p_max_per_run integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requeued integer := 0;
  v_skipped integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT cp.id AS package_id
    FROM public.course_packages cp
    WHERE cp.build_status = 'building'
      AND cp.integrity_passed = false
      AND (p_package_id IS NULL OR cp.id = p_package_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.meta->>'package_id' = cp.id::text
          AND jq.job_type = 'run_integrity_check'
          AND jq.status IN ('pending', 'processing')
      )
    LIMIT p_max_per_run
  LOOP
    IF NOT public.check_heal_cooldown(
      'requeue_integrity:' || rec.package_id::text, 6
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.job_queue (job_type, status, worker_pool, priority, meta)
    VALUES (
      'run_integrity_check', 'pending', 'core', 5,
      jsonb_build_object(
        'package_id', rec.package_id,
        'source', 'nightly_audit_rpc',
        'requeued_at', now()
      )
    );

    INSERT INTO public.audit_remediation_actions
      (run_id, module_key, action_key, entity_type, entity_id, status, cooldown_key, outcome_code, reason)
    VALUES
      (p_run_id, 'integrity_mismatch', 'requeue_integrity_check', 'package', rec.package_id::text,
       'succeeded', 'requeue_integrity:' || rec.package_id::text, 'requeued',
       format('Integrity check requeued for package %s', rec.package_id));

    v_requeued := v_requeued + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'requeued', v_requeued,
    'skipped_cooldown', v_skipped
  );
END;
$$;

-- 6. Drop and recreate v_audit_incidents with trend/persistence enrichment
DROP VIEW IF EXISTS public.v_audit_incidents;

CREATE OR REPLACE VIEW public.v_audit_incidents AS
WITH latest_run AS (
  SELECT id, started_at
  FROM public.nightly_audit_runs
  WHERE status = 'completed'
  ORDER BY started_at DESC
  LIMIT 1
),
recent_runs AS (
  SELECT id, started_at,
    ROW_NUMBER() OVER (ORDER BY started_at DESC) AS run_seq
  FROM public.nightly_audit_runs
  WHERE status = 'completed'
  ORDER BY started_at DESC
  LIMIT 7
),
entity_findings AS (
  SELECT
    f.entity_type,
    f.entity_id,
    f.run_id,
    f.finding_code,
    f.severity,
    f.finding_class,
    f.healed,
    f.metric_value,
    CASE f.severity
      WHEN 'critical' THEN 3
      WHEN 'warning' THEN 2
      WHEN 'info' THEN 1
      ELSE 0
    END AS severity_rank,
    CASE f.finding_class
      WHEN 'root_cause' THEN 3
      WHEN 'symptom' THEN 2
      WHEN 'consequence' THEN 1
      ELSE 0
    END AS class_rank
  FROM public.nightly_audit_findings f
  JOIN latest_run lr ON lr.id = f.run_id
  WHERE f.entity_id IS NOT NULL
    AND f.severity != 'info'
),
-- Count occurrences in last 7 runs per entity
history AS (
  SELECT
    f.entity_type,
    f.entity_id,
    COUNT(DISTINCT f.run_id) AS occurrence_count_last_7_runs,
    MIN(r.started_at) AS first_seen_in_window
  FROM public.nightly_audit_findings f
  JOIN recent_runs r ON r.id = f.run_id
  WHERE f.entity_id IS NOT NULL
    AND f.severity != 'info'
  GROUP BY f.entity_type, f.entity_id
),
-- Trend: compare current vs previous run metric
trend_data AS (
  SELECT
    curr.entity_type,
    curr.entity_id,
    SUM(curr.metric_value) AS current_metric,
    SUM(prev.metric_value) AS previous_metric
  FROM public.nightly_audit_findings curr
  JOIN latest_run lr ON lr.id = curr.run_id
  LEFT JOIN LATERAL (
    SELECT f2.metric_value, f2.entity_type, f2.entity_id
    FROM public.nightly_audit_findings f2
    JOIN public.nightly_audit_runs r2 ON r2.id = f2.run_id
    WHERE r2.status = 'completed'
      AND r2.started_at < lr.started_at
      AND f2.entity_type = curr.entity_type
      AND f2.entity_id = curr.entity_id
    ORDER BY r2.started_at DESC
    LIMIT 1
  ) prev ON true
  WHERE curr.entity_id IS NOT NULL
  GROUP BY curr.entity_type, curr.entity_id
),
grouped AS (
  SELECT
    ef.entity_type,
    ef.entity_id,
    ef.run_id,
    COUNT(*) AS evidence_count,
    MAX(ef.severity_rank) AS max_severity_rank,
    MAX(ef.class_rank) AS max_class_rank,
    BOOL_OR(ef.finding_code = 'hollow_completions') AS has_hollow_completions,
    BOOL_OR(ef.finding_code = 'done_below_threshold') AS has_done_below_threshold,
    BOOL_OR(ef.finding_code = 'false_success') AS has_false_success,
    BOOL_OR(ef.finding_code = 'shadow_zombies') AS has_shadow_zombies,
    BOOL_OR(ef.finding_code = 'integrity_mismatch') AS has_integrity_mismatch,
    BOOL_OR(ef.finding_code = 'stale_building_24h') AS has_stale_building,
    BOOL_OR(ef.finding_code ~~ 'heal_loop_%') AS has_heal_loop,
    BOOL_OR(ef.finding_code = 'publish_stuck') AS has_publish_stuck,
    BOOL_OR(ef.finding_code = 'processing_unlocked') AS has_processing_unlocked,
    array_agg(DISTINCT ef.finding_code) AS finding_codes,
    BOOL_OR(ef.healed) AS any_healed,
    BOOL_AND(ef.healed) AS all_healed,
    SUM(ef.metric_value) AS total_metric_value
  FROM entity_findings ef
  GROUP BY ef.entity_type, ef.entity_id, ef.run_id
  HAVING COUNT(*) >= 2
     OR (MAX(ef.severity_rank) >= 3 AND MAX(ef.class_rank) >= 3)
)
SELECT
  g.entity_type,
  g.entity_id,
  g.run_id,
  g.evidence_count,
  CASE g.max_severity_rank
    WHEN 3 THEN 'critical'
    WHEN 2 THEN 'warning'
    ELSE 'info'
  END AS max_severity,
  CASE g.max_class_rank
    WHEN 3 THEN 'root_cause'
    WHEN 2 THEN 'symptom'
    WHEN 1 THEN 'consequence'
    ELSE 'unknown'
  END AS max_finding_class,
  CASE
    WHEN g.max_class_rank >= 3 AND g.max_class_rank >= 2
      THEN 'root_cause+symptom'
    WHEN g.max_class_rank >= 3 THEN 'root_cause'
    WHEN g.max_class_rank >= 2 THEN 'symptom'
    ELSE 'consequence'
  END AS primary_finding_class,
  CASE
    WHEN g.has_hollow_completions OR g.has_done_below_threshold OR g.has_false_success
      THEN 'package_false_success_risk'
    WHEN g.has_shadow_zombies THEN 'package_shadow_zombie'
    WHEN g.has_integrity_mismatch THEN 'package_integrity_desync'
    WHEN g.has_stale_building THEN 'package_build_stall'
    WHEN g.has_heal_loop THEN 'package_heal_churn'
    WHEN g.has_publish_stuck THEN 'package_publish_blocked'
    WHEN g.has_processing_unlocked THEN 'job_corruption_risk'
    ELSE 'generic_incident'
  END AS incident_type,
  g.finding_codes,
  g.any_healed,
  g.all_healed,
  g.total_metric_value,
  -- Persistence enrichment
  COALESCE(h.occurrence_count_last_7_runs, 1) AS occurrence_count_last_7_runs,
  EXTRACT(EPOCH FROM (now() - COALESCE(h.first_seen_in_window, now()))) / 86400.0 AS days_open,
  -- Trend status
  CASE
    WHEN td.previous_metric IS NULL THEN 'new'
    WHEN td.current_metric > td.previous_metric * 1.5 THEN 'escalating'
    WHEN td.current_metric < td.previous_metric * 0.5 THEN 'improving'
    WHEN g.all_healed THEN 'resolved'
    WHEN g.any_healed THEN 'partially_healed'
    ELSE 'persistent'
  END AS trend_status
FROM grouped g
LEFT JOIN history h ON h.entity_type = g.entity_type AND h.entity_id = g.entity_id
LEFT JOIN trend_data td ON td.entity_type = g.entity_type AND td.entity_id = g.entity_id;
