-- ============================================================
-- S5d-2: Wire CPU-safe Burst v3 INTO claim_pending_jobs_v5.
-- Per-job-type Cap für PHK-sensitive Job-Types:
--   * 3 wenn phk_1h > 0
--   * 8 sonst
-- Andere Job-Types bleiben durch p_limit + per_pkg_cap begrenzt.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v5(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_worker_pool text DEFAULT NULL::text
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unique_pkgs int;
  v_per_pkg_cap int;
BEGIN
  SELECT COUNT(DISTINCT (payload->>'package_id'))
    INTO v_unique_pkgs
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND (payload->>'package_id') IS NOT NULL;

  v_per_pkg_cap := LEAST(10, GREATEST(3, CEIL(p_limit::numeric * 1.5 / GREATEST(v_unique_pkgs, 1))::int));

  RETURN QUERY
  WITH
  -- ── Per-job-type caps für PHK-sensitive Worker (Burst v3 Wiring) ──
  phk_caps AS (
    SELECT jt::text AS job_type,
           CASE
             WHEN (
               SELECT COUNT(*)
               FROM public.job_queue jq2
               WHERE jq2.job_type = jt
                 AND jq2.last_error_code IN ('PRE_HEARTBEAT_KILL','PRE_HEARTBEAT_KILL_TERMINAL')
                 AND jq2.updated_at > now() - interval '1 hour'
             ) > 0 THEN 3
             ELSE 8
           END AS cap
    FROM unnest(ARRAY[
      'package_quality_council',
      'package_run_integrity_check',
      'package_auto_publish',
      'package_validate_tutor_index',
      'package_build_ai_tutor_index'
    ]) AS jt
  ),
  candidates AS (
    SELECT jq.id, jq.job_type, jq.created_at, jq.priority,
           (jq.payload->>'package_id')::uuid AS pkg_id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE
          WHEN p_worker_pool IS NOT NULL THEN
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
          ELSE
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type
          AND q.cleared_at IS NULL
          AND q.blocked_until > now()
      )
      AND (
        jq.job_type NOT LIKE 'package_%'
        OR (jq.payload->>'package_id') IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.step_dag_edges dag
          JOIN public.package_steps ps
            ON ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = dag.depends_on
          WHERE dag.step_key = replace(jq.job_type, 'package_', '')
            AND ps.status NOT IN ('done', 'skipped')
        )
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit * 4
  ),
  -- ── Per-job-type Burst-v3 Cap anwenden ──
  capped AS (
    SELECT c.id, c.pkg_id, c.job_type, c.priority, c.created_at,
           row_number() OVER (
             PARTITION BY c.job_type
             ORDER BY c.priority ASC NULLS LAST, c.created_at ASC
           ) AS rn_jt
    FROM candidates c
  ),
  jt_filtered AS (
    SELECT cap.id, cap.pkg_id
    FROM capped cap
    LEFT JOIN phk_caps pc ON pc.job_type = cap.job_type
    -- Nicht-PHK-sensitive Job-Types: kein zusätzlicher Cap (pc.cap IS NULL)
    -- PHK-sensitive: rn_jt <= pc.cap
    WHERE pc.cap IS NULL OR cap.rn_jt <= pc.cap
  ),
  fair AS (
    SELECT jf.id
    FROM (
      SELECT id, pkg_id,
             row_number() OVER (PARTITION BY pkg_id ORDER BY (SELECT NULL)) AS rn
      FROM jt_filtered
    ) jf
    WHERE jf.rn <= v_per_pkg_cap
    ORDER BY (SELECT NULL)
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),
      attempts = COALESCE(q.attempts, 0) + 1,
      updated_at = now()
  FROM fair f
  WHERE q.id = f.id
  RETURNING q.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pending_jobs_v5(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_v5(text, integer, text) TO service_role;

INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'burst_v3_wired_into_claim_v5',
  'system',
  'claim_pending_jobs_v5',
  'applied',
  jsonb_build_object(
    'phk_sensitive_jobs', ARRAY[
      'package_quality_council',
      'package_run_integrity_check',
      'package_auto_publish',
      'package_validate_tutor_index',
      'package_build_ai_tutor_index'
    ],
    'cap_phk_active', 3,
    'cap_phk_idle', 8,
    'sprint', 'S5d'
  )
);