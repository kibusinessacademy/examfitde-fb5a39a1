-- ============================================================
-- Runner-Cycle Voll-Optimierung v1
-- ============================================================
-- 1. get_worker_scaling_recommendations: pool_fill_*, lesson_* erfasst
-- 2. worker_scaling_policies: Thresholds gesenkt für reaktivere Skalierung
-- 3. claim_pending_jobs_v4: dynamischer Fairness-Cap (mehr Slots pro Paket bei wenig Wettbewerb)
-- 4. v_runner_cycle_diagnostics: SSOT-View für Runner-Throughput-Monitoring
-- ============================================================

-- ── 1. Scaler erweitern: pool_fill_* und lesson_generate_* dem content-runner zuordnen
CREATE OR REPLACE FUNCTION public.get_worker_scaling_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb := '[]'::jsonb;
BEGIN
  WITH worker_stats AS (
    SELECT
      p.policy_key,
      p.worker_key,
      p.min_workers,
      p.max_workers,
      p.scale_up_pending_threshold,
      p.scale_down_pending_threshold,
      coalesce((r.meta->>'current_workers')::int, p.min_workers) as current_workers,
      CASE
        WHEN p.worker_key = 'content-runner' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND (
              job_type IN (
                'lesson_generate_content',
                'lesson_generate_competency_bundle',
                'lesson_generate_content_shard'
              )
              OR job_type LIKE 'pool_fill_%'
              OR job_type LIKE 'package_generate_%'
              OR job_type IN (
                'package_auto_seed_exam_blueprints',
                'package_elite_harden',
                'package_fanout_learning_content',
                'handbook_expand_section'
              )
            )
        )
        WHEN p.worker_key = 'pipeline-runner' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'package_%'
            AND job_type NOT LIKE 'package_generate_%'
        )
        WHEN p.worker_key = 'campaign-asset-worker' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'campaign_%'
        )
        WHEN p.worker_key = 'distribution-worker' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'distribution_%'
        )
        WHEN p.worker_key = 'optimization-executor' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'optimization_%'
        )
        ELSE 0
      END as pending_jobs
    FROM public.worker_scaling_policies p
    LEFT JOIN public.system_runner_registry r
      ON r.runner_key = p.worker_key
    WHERE p.is_enabled = true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'policy_key', ws.policy_key,
      'worker_key', ws.worker_key,
      'current_workers', ws.current_workers,
      'pending_jobs', ws.pending_jobs,
      'recommended_workers',
        CASE
          -- Scale up
          WHEN ws.pending_jobs >= ws.scale_up_pending_threshold
            AND ws.current_workers < ws.max_workers
            THEN LEAST(
              ws.max_workers,
              ws.current_workers + GREATEST(1, ws.pending_jobs / GREATEST(ws.scale_up_pending_threshold, 1))
            )
          -- Scale down
          WHEN ws.pending_jobs <= ws.scale_down_pending_threshold
            AND ws.current_workers > ws.min_workers
            THEN GREATEST(ws.min_workers, ws.current_workers - 1)
          ELSE ws.current_workers
        END
    )
  )
  INTO v_rows
  FROM worker_stats ws;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$function$;

-- ── 2. Thresholds senken (reaktivere Skalierung)
UPDATE public.worker_scaling_policies
SET scale_up_pending_threshold = 8,
    scale_down_pending_threshold = 2,
    updated_at = now()
WHERE worker_key = 'content-runner';

UPDATE public.worker_scaling_policies
SET scale_up_pending_threshold = 6,
    scale_down_pending_threshold = 2,
    updated_at = now()
WHERE worker_key = 'pipeline-runner';

UPDATE public.worker_scaling_policies
SET scale_up_pending_threshold = 5,
    scale_down_pending_threshold = 1,
    updated_at = now()
WHERE worker_key IN ('campaign-asset-worker','distribution-worker');

UPDATE public.worker_scaling_policies
SET scale_up_pending_threshold = 4,
    scale_down_pending_threshold = 1,
    updated_at = now()
WHERE worker_key = 'optimization-executor';

-- ── 3. claim_pending_jobs_v4: dynamischer Fairness-Cap
-- Wenn nur wenige Pakete in der Queue sind (≤2 unique pkg_ids), erhöhe Cap auf 8 pro Paket.
-- Bei vielen konkurrierenden Paketen bleibt Cap bei 3 (Anti-Monopol).
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit integer DEFAULT 5,
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
  -- Schätze Wettbewerb: wie viele unique Pakete haben pending Jobs?
  SELECT COUNT(DISTINCT (payload->>'package_id'))
    INTO v_unique_pkgs
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND (payload->>'package_id') IS NOT NULL;

  -- Dynamischer Cap: bei ≤2 Paketen → 8 Jobs/Paket; ≤5 → 5; sonst 3
  v_per_pkg_cap := CASE
    WHEN v_unique_pkgs <= 2 THEN 8
    WHEN v_unique_pkgs <= 5 THEN 5
    ELSE 3
  END;

  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.job_type,
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
  fair AS (
    SELECT c.id
    FROM (
      SELECT id, pkg_id,
             row_number() OVER (PARTITION BY pkg_id ORDER BY (SELECT NULL)) AS rn
      FROM candidates
    ) c
    WHERE c.rn <= v_per_pkg_cap
    ORDER BY (SELECT NULL)
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM fair f
  WHERE q.id = f.id
  RETURNING q.*;
END;
$function$;

-- ── 4. Diagnose-View für Runner-Throughput-Monitoring
CREATE OR REPLACE VIEW public.v_runner_cycle_diagnostics AS
WITH pending AS (
  SELECT
    job_type,
    count(*) FILTER (WHERE status = 'pending') AS pending_count,
    count(*) FILTER (WHERE status = 'pending' AND (run_after IS NULL OR run_after <= now())) AS claimable_now,
    count(*) FILTER (WHERE status = 'processing') AS processing_count,
    min(created_at) FILTER (WHERE status = 'pending') AS oldest_pending,
    max(priority) FILTER (WHERE status = 'pending') AS max_priority
  FROM public.job_queue
  WHERE status IN ('pending','processing')
  GROUP BY job_type
),
throughput AS (
  SELECT
    job_type,
    count(*) FILTER (WHERE started_at > now() - interval '5 minutes') AS claimed_last_5m,
    count(*) FILTER (WHERE completed_at > now() - interval '5 minutes' AND status = 'completed') AS done_last_5m,
    count(*) FILTER (WHERE completed_at > now() - interval '5 minutes' AND status = 'failed') AS failed_last_5m
  FROM public.job_queue
  WHERE started_at > now() - interval '15 minutes' OR completed_at > now() - interval '15 minutes'
  GROUP BY job_type
)
SELECT
  COALESCE(p.job_type, t.job_type) AS job_type,
  COALESCE(p.pending_count, 0) AS pending,
  COALESCE(p.claimable_now, 0) AS claimable_now,
  COALESCE(p.processing_count, 0) AS processing,
  COALESCE(t.claimed_last_5m, 0) AS claimed_5m,
  COALESCE(t.done_last_5m, 0) AS done_5m,
  COALESCE(t.failed_last_5m, 0) AS failed_5m,
  p.oldest_pending,
  p.max_priority,
  CASE
    WHEN p.job_type LIKE 'package_%' AND p.job_type NOT LIKE 'package_generate_%' THEN 'pipeline-runner'
    WHEN p.job_type IN ('lesson_generate_content','lesson_generate_competency_bundle','lesson_generate_content_shard')
      OR p.job_type LIKE 'pool_fill_%'
      OR p.job_type LIKE 'package_generate_%'
      OR p.job_type IN ('package_auto_seed_exam_blueprints','package_elite_harden','package_fanout_learning_content','handbook_expand_section')
      THEN 'content-runner'
    WHEN p.job_type LIKE 'campaign_%' THEN 'campaign-asset-worker'
    WHEN p.job_type LIKE 'distribution_%' THEN 'distribution-worker'
    WHEN p.job_type LIKE 'optimization_%' THEN 'optimization-executor'
    ELSE 'unrouted'
  END AS routed_to_worker,
  EXTRACT(EPOCH FROM (now() - p.oldest_pending))::int AS oldest_pending_age_sec
FROM pending p
FULL OUTER JOIN throughput t ON t.job_type = p.job_type
ORDER BY pending DESC NULLS LAST, claimed_5m DESC;

GRANT SELECT ON public.v_runner_cycle_diagnostics TO authenticated, service_role;

-- Audit
INSERT INTO public.admin_actions (action, scope, payload)
VALUES (
  'runner_cycle_optimization_v1',
  'governance',
  jsonb_build_object(
    'changes', jsonb_build_array(
      'scaler_routing_pool_fill_lesson',
      'thresholds_lowered',
      'fairness_cap_dynamic',
      'diagnostic_view_added'
    ),
    'expected_throughput_increase', '3-5x for pool_fill backlog'
  )
);