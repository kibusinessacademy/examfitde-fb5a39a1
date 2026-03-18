
-- ============================================================
-- 1. Telemetry + Drift Integrity Audit View
-- ============================================================

CREATE OR REPLACE VIEW public.ops_telemetry_integrity AS
WITH building_pkgs AS (
  SELECT cp.id AS package_id,
         cp.course_id,
         cp.title,
         cp.status,
         cp.build_progress AS stored_progress,
         cp.updated_at AS pkg_updated_at
  FROM course_packages cp
  WHERE cp.status IN ('building','review','queued')
),
content_counts AS (
  SELECT bp.package_id,
         count(*) FILTER (WHERE cv.created_at >= now() - interval '24 hours') AS content_versions_24h,
         max(cv.created_at) AS last_content_at
  FROM content_versions cv
  JOIN building_pkgs bp ON bp.course_id = cv.course_id
  GROUP BY bp.package_id
),
llm_counts AS (
  SELECT lce.package_id,
         count(*) FILTER (WHERE lce.ts >= now() - interval '24 hours') AS llm_cost_events_24h,
         max(lce.ts) AS last_llm_at
  FROM llm_cost_events lce
  WHERE lce.package_id IN (SELECT package_id FROM building_pkgs)
  GROUP BY lce.package_id
),
llm_breakdown AS (
  SELECT lce.package_id,
         lce.provider,
         lce.model,
         lce.job_type,
         count(*) AS events_24h
  FROM llm_cost_events lce
  WHERE lce.package_id IN (SELECT package_id FROM building_pkgs)
    AND lce.ts >= now() - interval '24 hours'
  GROUP BY lce.package_id, lce.provider, lce.model, lce.job_type
),
llm_breakdown_agg AS (
  SELECT package_id,
         jsonb_agg(jsonb_build_object(
           'provider', provider, 'model', model,
           'job_type', job_type, 'events_24h', events_24h
         ) ORDER BY events_24h DESC) AS breakdown
  FROM llm_breakdown
  GROUP BY package_id
),
artifact_progress AS (
  SELECT oab.package_id, oab.real_progress, oab.content_pct,
         oab.exam_pct, oab.minicheck_pct, oab.handbook_pct, oab.steps_done_pct
  FROM ops_artifact_build_progress oab
),
job_activity AS (
  SELECT jq.package_id,
         max(jq.updated_at) AS last_job_at,
         count(*) FILTER (WHERE jq.status = 'processing') AS active_jobs,
         count(*) FILTER (WHERE jq.status = 'pending') AS pending_jobs
  FROM job_queue jq
  WHERE jq.package_id IN (SELECT package_id FROM building_pkgs)
  GROUP BY jq.package_id
),
missing_artifacts AS (
  SELECT ps.package_id,
         array_agg(ps.step_key ORDER BY ps.step_key) AS missing_steps
  FROM package_steps ps
  WHERE ps.package_id IN (SELECT package_id FROM building_pkgs)
    AND ps.status NOT IN ('done', 'skipped')
  GROUP BY ps.package_id
)
SELECT
  bp.package_id,
  bp.title,
  bp.status,
  bp.stored_progress,
  COALESCE(ap.real_progress, 0)::int AS real_progress,
  (COALESCE(ap.real_progress, 0) - bp.stored_progress)::int AS drift,
  COALESCE(cc.content_versions_24h, 0)::int AS content_versions_24h,
  COALESCE(lc.llm_cost_events_24h, 0)::int AS llm_cost_events_24h,
  CASE
    WHEN COALESCE(cc.content_versions_24h, 0) = 0 THEN 0
    WHEN COALESCE(lc.llm_cost_events_24h, 0) = 0 THEN -1
    ELSE round(lc.llm_cost_events_24h::numeric / cc.content_versions_24h::numeric, 2)
  END AS telemetry_ratio,
  CASE
    WHEN COALESCE(cc.content_versions_24h, 0) > 10
         AND COALESCE(lc.llm_cost_events_24h, 0) < COALESCE(cc.content_versions_24h, 0) * 0.3
    THEN true ELSE false
  END AS logging_gap,
  CASE
    WHEN ABS(COALESCE(ap.real_progress, 0) - bp.stored_progress) > 10 THEN 'critical'
    WHEN ABS(COALESCE(ap.real_progress, 0) - bp.stored_progress) > 5 THEN 'warning'
    ELSE 'ok'
  END AS drift_severity,
  COALESCE(ap.content_pct, 0)::int AS content_pct,
  COALESCE(ap.exam_pct, 0)::int AS exam_pct,
  COALESCE(ap.minicheck_pct, 0)::int AS minicheck_pct,
  COALESCE(ap.handbook_pct, 0)::int AS handbook_pct,
  COALESCE(ap.steps_done_pct, 0)::int AS steps_done_pct,
  COALESCE(ja.active_jobs, 0)::int AS active_jobs,
  COALESCE(ja.pending_jobs, 0)::int AS pending_jobs,
  cc.last_content_at,
  lc.last_llm_at,
  ja.last_job_at,
  GREATEST(cc.last_content_at, lc.last_llm_at, ja.last_job_at, bp.pkg_updated_at) AS last_any_activity,
  ma.missing_steps,
  lba.breakdown AS llm_breakdown,
  now() AS computed_at
FROM building_pkgs bp
LEFT JOIN content_counts cc ON cc.package_id = bp.package_id
LEFT JOIN llm_counts lc ON lc.package_id = bp.package_id
LEFT JOIN artifact_progress ap ON ap.package_id = bp.package_id
LEFT JOIN job_activity ja ON ja.package_id = bp.package_id
LEFT JOIN missing_artifacts ma ON ma.package_id = bp.package_id
LEFT JOIN llm_breakdown_agg lba ON lba.package_id = bp.package_id
ORDER BY COALESCE(ap.real_progress, 0) DESC;

-- ============================================================
-- 2. Recovery RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.repair_missing_finalize_artifact(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_created boolean := false;
  v_validate_reset boolean := false;
BEGIN
  INSERT INTO package_steps (package_id, step_key, status, attempts)
  VALUES (p_package_id, 'finalize_learning_content', 'pending', 0)
  ON CONFLICT (package_id, step_key) DO NOTHING;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  UPDATE package_steps
  SET status = 'pending', attempts = 0, updated_at = now()
  WHERE package_id = p_package_id
    AND step_key = 'validate_learning_content'
    AND status IN ('failed', 'blocked');
  GET DIAGNOSTICS v_validate_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'finalize_created', COALESCE(v_created, false),
    'validate_reset', COALESCE(v_validate_reset, false)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.clear_stale_guard_loops(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cancelled int := 0;
  v_unblocked int := 0;
BEGIN
  WITH c AS (
    UPDATE job_queue SET status = 'cancelled',
      error = COALESCE(error,'') || ' [clear_stale_guard_loops]',
      updated_at = now()
    WHERE package_id = p_package_id
      AND status IN ('failed','processing')
      AND updated_at < now() - interval '2 hours'
    RETURNING id
  ) SELECT count(*) INTO v_cancelled FROM c;

  WITH u AS (
    UPDATE package_steps SET status = 'pending', attempts = 0, updated_at = now()
    WHERE package_id = p_package_id AND status = 'blocked'
    RETURNING step_key
  ) SELECT count(*) INTO v_unblocked FROM u;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'cancelled_jobs', v_cancelled,
    'unblocked_steps', v_unblocked
  );
END; $$;

CREATE OR REPLACE FUNCTION public.reconcile_package_progress(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old int; v_new numeric; v_updated boolean := false;
BEGIN
  SELECT build_progress INTO v_old FROM course_packages WHERE id = p_package_id;
  SELECT real_progress INTO v_new FROM ops_artifact_build_progress WHERE package_id = p_package_id;

  IF v_new IS NOT NULL AND ABS(COALESCE(v_old,0) - v_new) > 2 THEN
    UPDATE course_packages SET build_progress = ROUND(v_new)::int, updated_at = now()
    WHERE id = p_package_id;
    v_updated := true;
  END IF;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'old_progress', COALESCE(v_old,0),
    'real_progress', COALESCE(v_new,0),
    'updated', v_updated
  );
END; $$;

-- ============================================================
-- 3. Telemetry Gap Alert function
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_telemetry_gap_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gaps jsonb; v_count int;
BEGIN
  SELECT jsonb_agg(row_to_json(g)), count(*)
  INTO v_gaps, v_count
  FROM (
    SELECT package_id, title, content_versions_24h, llm_cost_events_24h, telemetry_ratio
    FROM ops_telemetry_integrity WHERE logging_gap = true
    ORDER BY content_versions_24h DESC LIMIT 20
  ) g;

  IF COALESCE(v_count,0) > 0 THEN
    INSERT INTO ops_alert_events (alert_key, severity, summary, details)
    VALUES (
      'telemetry_logging_gap',
      CASE WHEN v_count > 5 THEN 'critical' ELSE 'warning' END,
      v_count || ' packages have telemetry logging gaps',
      COALESCE(v_gaps, '[]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object('gap_count', COALESCE(v_count,0), 'packages', COALESCE(v_gaps,'[]'::jsonb));
END; $$;
