-- ============================================================
-- OPS_CANCEL_SKIP_RISE — Live Dashboard + Top Partitions + Runbook
-- ============================================================

-- 1) Live counters (current vs previous 60 min)
CREATE OR REPLACE VIEW public.v_ops_cancel_skip_rise_live AS
WITH cur AS (
  SELECT COUNT(*) AS n FROM public.auto_heal_log
  WHERE action_type = 'ops_cancel_pending_non_building_job_skipped'
    AND created_at >= now() - interval '60 minutes'
), prev AS (
  SELECT COUNT(*) AS n FROM public.auto_heal_log
  WHERE action_type = 'ops_cancel_pending_non_building_job_skipped'
    AND created_at >= now() - interval '120 minutes'
    AND created_at <  now() - interval '60 minutes'
), cancels AS (
  SELECT COUNT(*) AS n FROM public.auto_heal_log
  WHERE action_type = 'ops_cancel_pending_non_building_job'
    AND created_at >= now() - interval '60 minutes'
)
SELECT
  cur.n  AS current_60m,
  prev.n AS previous_60m,
  cancels.n AS cancels_60m,
  CASE WHEN prev.n = 0 THEN NULL
       ELSE ROUND(cur.n::numeric / NULLIF(prev.n,0), 2)
  END AS multiplier,
  CASE
    WHEN cur.n >= 50 THEN 'crit'
    WHEN cur.n >= 20 THEN 'warn'
    WHEN cur.n >= 5 AND prev.n > 0 AND cur.n >= prev.n * 3 THEN 'warn'
    ELSE 'ok'
  END AS severity,
  CASE
    WHEN cur.n >= 50 THEN 'crit: skips/h ≥ 50 (hard ceiling — repair-policy fehlt flächendeckend)'
    WHEN cur.n >= 20 THEN 'warn: skips/h ≥ 20 (Cluster-Verdacht — Repair-Welle ohne exempt_from_auto_cancel)'
    WHEN cur.n >= 5 AND prev.n > 0 AND cur.n >= prev.n * 3
      THEN 'warn: skips/h ≥ 5 UND ≥ 3× Vorstunde (plötzlicher Anstieg)'
    ELSE 'ok: alle Schwellen unterschritten'
  END AS threshold_explained,
  20  AS threshold_warn_absolute,
  50  AS threshold_crit_absolute,
  5   AS threshold_warn_min_for_multiplier,
  3.0 AS threshold_warn_multiplier,
  now() AS measured_at
FROM cur, prev, cancels;

REVOKE ALL ON public.v_ops_cancel_skip_rise_live FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ops_cancel_skip_rise_live TO service_role;

-- 2) Top partitions (job_type × protect_reason × package_id) last 60 min
CREATE OR REPLACE VIEW public.v_ops_cancel_skip_top_partitions_60m AS
WITH skips AS (
  SELECT
    COALESCE(NULLIF(metadata->>'job_type',''), 'unknown')      AS job_type,
    COALESCE(NULLIF(metadata->>'protect_reason',''),
             NULLIF(metadata->>'cancel_reason',''),
             'unspecified')                                     AS protect_reason,
    NULLIF(metadata->>'package_id','')::uuid                    AS package_id,
    COALESCE(NULLIF(metadata->>'package_status',''), 'unknown') AS package_status,
    created_at
  FROM public.auto_heal_log
  WHERE action_type = 'ops_cancel_pending_non_building_job_skipped'
    AND created_at >= now() - interval '60 minutes'
), total AS (
  SELECT COUNT(*) AS n FROM skips
)
SELECT
  s.job_type,
  s.protect_reason,
  s.package_id,
  s.package_status,
  COUNT(*) AS skips,
  MIN(s.created_at) AS first_seen,
  MAX(s.created_at) AS last_seen,
  ROUND( COUNT(*)::numeric / NULLIF((SELECT n FROM total),0) * 100.0, 1) AS pct_of_total
FROM skips s
GROUP BY 1,2,3,4
ORDER BY skips DESC;

REVOKE ALL ON public.v_ops_cancel_skip_top_partitions_60m FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ops_cancel_skip_top_partitions_60m TO service_role;

-- 3) Admin dashboard RPC
CREATE OR REPLACE FUNCTION public.admin_get_ops_cancel_skip_rise_dashboard(
  p_window_min int DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_metrics jsonb;
  v_top jsonb;
  v_recent_skips jsonb;
  v_recent_cancels jsonb;
  v_jobs_context jsonb;
  v_runbook text;
  v_window_min int := GREATEST(LEAST(COALESCE(p_window_min,60), 360), 5);
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT to_jsonb(l) INTO v_metrics FROM public.v_ops_cancel_skip_rise_live l;

  SELECT jsonb_agg(row_to_json(p)) INTO v_top
  FROM (
    SELECT * FROM public.v_ops_cancel_skip_top_partitions_60m LIMIT 25
  ) p;

  SELECT jsonb_agg(row_to_json(r) ORDER BY (r).created_at DESC) INTO v_recent_skips
  FROM (
    SELECT
      ahl.id,
      ahl.created_at,
      ahl.target_id AS job_id,
      ahl.metadata->>'job_type'        AS job_type,
      ahl.metadata->>'protect_reason'  AS protect_reason,
      ahl.metadata->>'package_id'      AS package_id,
      ahl.metadata->>'package_status'  AS package_status,
      (ahl.metadata->>'can_run_when_not_building')::boolean AS can_run_when_not_building,
      (ahl.metadata->>'exempt_from_auto_cancel')::boolean   AS exempt_from_auto_cancel,
      (ahl.metadata->>'payload_is_repair')::boolean         AS payload_is_repair,
      (ahl.metadata->>'meta_is_repair')::boolean            AS meta_is_repair
    FROM public.auto_heal_log ahl
    WHERE ahl.action_type = 'ops_cancel_pending_non_building_job_skipped'
      AND ahl.created_at >= now() - make_interval(mins => v_window_min)
    ORDER BY ahl.created_at DESC
    LIMIT 30
  ) r;

  SELECT jsonb_agg(row_to_json(r) ORDER BY (r).created_at DESC) INTO v_recent_cancels
  FROM (
    SELECT
      ahl.id,
      ahl.created_at,
      ahl.target_id AS job_id,
      ahl.metadata->>'job_type'       AS job_type,
      ahl.metadata->>'cancel_reason'  AS cancel_reason,
      ahl.metadata->>'package_id'     AS package_id,
      ahl.metadata->>'package_status' AS package_status,
      ahl.metadata->>'previous_status' AS previous_status
    FROM public.auto_heal_log ahl
    WHERE ahl.action_type = 'ops_cancel_pending_non_building_job'
      AND ahl.created_at >= now() - make_interval(mins => v_window_min)
    ORDER BY ahl.created_at DESC
    LIMIT 30
  ) r;

  -- Live job_queue context for the most recent skipped/cancelled jobs
  SELECT jsonb_agg(row_to_json(j)) INTO v_jobs_context
  FROM (
    SELECT
      jq.id,
      jq.job_type,
      jq.status,
      jq.worker_pool,
      jq.lane,
      jq.attempts,
      jq.max_attempts,
      jq.run_after,
      jq.locked_at,
      jq.locked_by,
      jq.last_error_code,
      LEFT(COALESCE(jq.last_error,''), 240) AS last_error,
      jq.package_id,
      (jq.payload->>'is_repair')::boolean AS payload_is_repair,
      (jq.meta->>'is_repair')::boolean    AS meta_is_repair,
      (jq.meta->>'exempt_from_auto_cancel')::boolean AS exempt_from_auto_cancel,
      (jq.meta->>'can_run_when_not_building')::boolean AS can_run_when_not_building,
      jq.updated_at
    FROM public.job_queue jq
    WHERE jq.id::text IN (
      SELECT ahl.target_id FROM public.auto_heal_log ahl
      WHERE ahl.action_type IN ('ops_cancel_pending_non_building_job_skipped','ops_cancel_pending_non_building_job')
        AND ahl.target_id IS NOT NULL
        AND ahl.created_at >= now() - make_interval(mins => v_window_min)
      ORDER BY ahl.created_at DESC
      LIMIT 30
    )
  ) j;

  v_runbook := concat(
    '## OPS_CANCEL_SKIP_RISE — Runbook', E'\n\n',
    '**Schwellwerte**', E'\n',
    '- ok: < 5 Skips / 60min', E'\n',
    '- warn: ≥ 20 (absolut) ODER ≥ 5 UND ≥ 3× der Vorstunde', E'\n',
    '- crit: ≥ 50 (absolut)', E'\n\n',
    '**Diagnose-Schritte**', E'\n',
    '1. Top job_type × protect_reason in der Tabelle ansehen — clusterte Reason zeigt fehlende Repair-Policy.', E'\n',
    '2. Stimmt protect_reason=`repair_flag_payload`/`repair_flag_meta`, ist der Cancel korrekt verhindert worden — kein Handlungsbedarf.', E'\n',
    '3. Stimmt protect_reason=`exempt_from_auto_cancel` UND es entstehen viele Skips, prüfe, ob ein Producer das Flag fälschlich global setzt.', E'\n',
    '4. Bei job_type=`package_repair_*` aber protect_reason=`unspecified` → Producer fehlt das exempt-Flag. Fix im jeweiligen Producer (enqueue mit meta.exempt_from_auto_cancel=true).', E'\n\n',
    '**Forensik-Queries**', E'\n',
    '```sql', E'\n',
    '-- Letzte Skips mit voller Metadata', E'\n',
    'SELECT created_at, target_id, metadata FROM auto_heal_log', E'\n',
    'WHERE action_type=''ops_cancel_pending_non_building_job_skipped''', E'\n',
    'ORDER BY created_at DESC LIMIT 20;', E'\n\n',
    '-- Job-Kontext zu einem Skip', E'\n',
    'SELECT id, job_type, status, payload, meta, last_error, locked_at, attempts', E'\n',
    'FROM job_queue WHERE id = ''<job_id>'';', E'\n',
    '```', E'\n\n',
    '**Fix-Hebel**', E'\n',
    '- Producer-Side: `meta.exempt_from_auto_cancel=true` für legitime Repair-Jobs.', E'\n',
    '- Notfall-Reaktivierung einzelner Jobs: `SELECT admin_revive_cancelled_job(''<id>'',''reason'',''pending'');`', E'\n',
    '- Cancel-Funktion: `ops_cancel_pending_non_building_jobs` (security definer) zeigt jeden Skip mit Begründung.'
  );

  -- Light-weight audit
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'admin_ops_cancel_skip_rise_dashboard_view',
    'system', NULL, 'ok',
    jsonb_build_object(
      'actor_uid', v_uid,
      'window_min', v_window_min,
      'current_60m', v_metrics->>'current_60m',
      'severity',    v_metrics->>'severity'
    )
  );

  RETURN jsonb_build_object(
    'metrics',         COALESCE(v_metrics,         '{}'::jsonb),
    'top_partitions',  COALESCE(v_top,             '[]'::jsonb),
    'recent_skips',    COALESCE(v_recent_skips,    '[]'::jsonb),
    'recent_cancels',  COALESCE(v_recent_cancels,  '[]'::jsonb),
    'jobs_context',    COALESCE(v_jobs_context,    '[]'::jsonb),
    'runbook',         v_runbook,
    'window_min',      v_window_min,
    'generated_at',    now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_ops_cancel_skip_rise_dashboard(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ops_cancel_skip_rise_dashboard(int) TO authenticated;