-- ============================================================
-- LANE-HEALTH OPTIMIERUNG v1: A+B+C+D
-- A: claim_pending_jobs_v5 mit dynamischem per_pkg_cap
-- B: fn_detect_tail_step_enqueue_drift (generalisiert)
-- C: Auto-Scaler-Audit aktivieren (Diagnose-RPC)
-- D: prebuild-Pool-Cron
-- ============================================================

-- ============== FIX A: claim_pending_jobs_v5 ==============
-- Per-Pkg-Cap dynamisch: bei vielen pkgs UND vielen pending pro pkg ist cap=3 zu strikt.
-- Neue Formel: cap = MAX(3, CEIL(p_limit * 1.5 / GREATEST(unique_pkgs, 1)))
-- Bei 44 pkgs + p_limit=20 → cap=3 (wie heute, fair); bei 5 pkgs + p_limit=20 → cap=6
-- Plus: p_limit Default auf 10 erhöht (war 5).

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v5(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_worker_pool text DEFAULT NULL
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

  -- Dynamisch: bei vielen pkgs trotzdem fair, aber min 3, max 10
  v_per_pkg_cap := LEAST(10, GREATEST(3, CEIL(p_limit::numeric * 1.5 / GREATEST(v_unique_pkgs, 1))::int));

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

GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_v5(text, integer, text) TO service_role;

-- ============== FIX B: Tail-Step-Enqueue-Drift Heal (generalisiert) ==============
-- Heilt Pakete, deren Vorgänger-Step in 'queued' hängt OHNE entsprechenden Job in queue.
-- Wirkt für ALLE step_dag_edges (nicht nur exam_pool).

CREATE OR REPLACE FUNCTION public.fn_detect_tail_step_enqueue_drift()
RETURNS TABLE(
  package_id uuid,
  step_key text,
  action text,
  job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_job_id uuid;
  v_total int := 0;
  v_healed int := 0;
  v_skipped int := 0;
BEGIN
  -- Finde Steps die in 'queued' >2h hängen, ohne entsprechenden Job in queue
  FOR v_rec IN
    SELECT 
      ps.package_id,
      ps.step_key,
      ps.updated_at,
      cp.status AS pkg_status,
      EXTRACT(EPOCH FROM (now() - ps.updated_at))/3600 AS hrs_stuck
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND ps.updated_at < now() - interval '2 hours'
      AND cp.status = 'building'
      -- Kein offener Job für diesen Step
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.payload->>'package_id' = ps.package_id::text
          AND jq.job_type = 'package_' || ps.step_key
          AND jq.status IN ('pending','processing')
      )
      -- Cooldown 30min (kein recent heal-attempt)
      AND NOT EXISTS (
        SELECT 1 FROM auto_heal_log ahl
        WHERE ahl.action_type = 'tail_step_enqueue_drift_heal'
          AND ahl.target_id = ps.package_id::text
          AND ahl.metadata->>'step_key' = ps.step_key
          AND ahl.created_at > now() - interval '30 minutes'
      )
      -- DAG-Vorgänger muss done sein (sonst kein "ready to enqueue")
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps ps2 ON ps2.package_id=ps.package_id AND ps2.step_key=dag.depends_on
        WHERE dag.step_key = ps.step_key AND ps2.status NOT IN ('done','skipped')
      )
    ORDER BY ps.updated_at ASC
    LIMIT 50
  LOOP
    v_total := v_total + 1;
    BEGIN
      -- Enqueue: insert job, lasse trigger die step_status auf 'queued' lassen
      INSERT INTO job_queue (
        job_type, payload, status, priority, created_at, run_after,
        job_name, correlation_id
      ) VALUES (
        'package_' || v_rec.step_key,
        jsonb_build_object('package_id', v_rec.package_id, 'source', 'tail_step_drift_heal'),
        'pending', 50, now(), now(),
        'tail_drift_heal:' || v_rec.step_key || ':' || v_rec.package_id::text,
        gen_random_uuid()
      )
      RETURNING id INTO v_job_id;

      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'tail_step_enqueue_drift_heal',
        'package',
        v_rec.package_id::text,
        'success',
        jsonb_build_object(
          'step_key', v_rec.step_key,
          'job_id', v_job_id,
          'hrs_stuck', round(v_rec.hrs_stuck::numeric, 1),
          'pkg_status', v_rec.pkg_status
        )
      );
      v_healed := v_healed + 1;
      package_id := v_rec.package_id; step_key := v_rec.step_key; 
      action := 'enqueued'; job_id := v_job_id; RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'tail_step_enqueue_drift_heal',
        'package',
        v_rec.package_id::text,
        'failed',
        jsonb_build_object('step_key', v_rec.step_key, 'error', SQLERRM)
      );
    END;
  END LOOP;

  -- Run-Summary
  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'tail_step_enqueue_drift_run',
    'system',
    CASE WHEN v_total=0 THEN 'noop' ELSE 'success' END,
    jsonb_build_object('total', v_total, 'healed', v_healed, 'skipped', v_skipped)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_detect_tail_step_enqueue_drift() TO service_role;

-- ============== FIX C: Auto-Scaler Diagnose-RPC ==============
-- Liefert genau das, was der scaler sehen sollte. Macht Decision transparent.
-- Audit-Trail erzwingen: jedes Aufruf wird geloggt (auch noop).

CREATE OR REPLACE FUNCTION public.fn_auto_scaler_decide()
RETURNS TABLE(
  pool text,
  pending int,
  processing int,
  unique_pkgs int,
  recommended_workers int,
  decision text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_decisions jsonb := '[]'::jsonb;
BEGIN
  FOR v_rec IN
    SELECT 
      COALESCE(jq.worker_pool, jtp.worker_pool, 'default') AS effective_pool,
      COUNT(*) FILTER (WHERE jq.status='pending' AND (jq.run_after IS NULL OR jq.run_after <= now())) AS pending_cnt,
      COUNT(*) FILTER (WHERE jq.status='processing') AS proc_cnt,
      COUNT(DISTINCT jq.payload->>'package_id') FILTER (WHERE jq.status='pending') AS pkgs
    FROM job_queue jq
    LEFT JOIN job_type_policies jtp ON jtp.job_type=jq.job_type
    WHERE jq.status IN ('pending','processing')
    GROUP BY 1
  LOOP
    pool := v_rec.effective_pool;
    pending := v_rec.pending_cnt;
    processing := v_rec.proc_cnt;
    unique_pkgs := v_rec.pkgs;
    -- Heuristik: 1 Worker pro 25 pending + Floor 1, max 5
    recommended_workers := LEAST(5, GREATEST(1, CEIL(v_rec.pending_cnt::numeric / 25)::int));
    decision := CASE 
      WHEN v_rec.pending_cnt = 0 THEN 'idle'
      WHEN v_rec.pending_cnt < 25 THEN 'minimal (1 worker)'
      WHEN v_rec.pending_cnt < 100 THEN 'normal (2-3 workers)'
      ELSE 'scale_up (4-5 workers)'
    END;
    v_decisions := v_decisions || jsonb_build_object(
      'pool', pool, 'pending', pending, 'processing', processing, 
      'unique_pkgs', unique_pkgs, 'recommended_workers', recommended_workers, 'decision', decision
    );
    RETURN NEXT;
  END LOOP;
  
  -- Audit
  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('auto_scaler_decision', 'system', 'success', jsonb_build_object('decisions', v_decisions));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_auto_scaler_decide() TO service_role;

-- ============== FIX D: prebuild-Pool-Cron ==============
-- Cron-Hook: alle 2min content-runner mit p_worker_pool='prebuild' aufrufen.
-- Wird im nächsten Schritt via cron.schedule (ohne migration, weil URL+key) gesetzt.

-- Markiere Setup-Anker
INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('lane_health_optimization_v1_deployed', 'system', 'success', 
  jsonb_build_object(
    'fixes', ARRAY['claim_pending_jobs_v5', 'fn_detect_tail_step_enqueue_drift', 'fn_auto_scaler_decide'],
    'prebuild_cron_pending', true,
    'deployed_at', now()
  ));

COMMENT ON FUNCTION public.claim_pending_jobs_v5 IS 
  'v5: Dynamic per_pkg_cap. Higher Throughput bei vielen pkgs. Default p_limit=10 (war 5).';
COMMENT ON FUNCTION public.fn_detect_tail_step_enqueue_drift IS 
  'Generalisiertes Tail-Step Enqueue-Drift Heal. Wirkt auf ALLE step_dag_edges. Cron via cron.schedule (extern).';
COMMENT ON FUNCTION public.fn_auto_scaler_decide IS 
  'Auto-Scaler Decision-Engine mit Audit. Loggt jede Decision in auto_heal_log.';