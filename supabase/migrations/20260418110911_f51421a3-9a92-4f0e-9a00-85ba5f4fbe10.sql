-- ============================================================
-- Phase 2 Härtung: Hot-Loop-Schutz + Materialization-Routing
-- ============================================================

-- 1) Quarantäne-Tabelle
CREATE TABLE IF NOT EXISTS public.package_job_quarantine (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  package_id uuid NOT NULL,
  job_type text NOT NULL,
  failure_signature text NOT NULL,
  identical_fail_count integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  blocked_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz NULL,
  cleared_by text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pkg_quarantine_active
  ON public.package_job_quarantine (package_id, job_type)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pkg_quarantine_blocked_until
  ON public.package_job_quarantine (blocked_until)
  WHERE cleared_at IS NULL;

ALTER TABLE public.package_job_quarantine ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins can read quarantines" ON public.package_job_quarantine;
CREATE POLICY "admins can read quarantines"
  ON public.package_job_quarantine
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Failure-Signatur-Extraktor (PG-side, parität zu poison-loop-guard.ts)
CREATE OR REPLACE FUNCTION public.fn_extract_failure_signature(p_last_error text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_err text := COALESCE(p_last_error, '');
  v_match text;
BEGIN
  -- Step finalize race → eigener bucket (kein "failure")
  IF v_err ILIKE '%step_finalized_job_obsoleted%' THEN
    RETURN 'OBSOLETE_RACE';
  END IF;

  -- MATERIALIZATION_GUARD
  v_match := substring(v_err FROM 'MATERIALIZATION_GUARD:\s*([^—\n]+)');
  IF v_match IS NOT NULL THEN
    RETURN 'MAT_GUARD:' || left(trim(v_match), 200);
  END IF;

  -- TOO_FEW_CHUNKS variant
  v_match := substring(v_err FROM 'TOO_FEW_CHUNKS:\s*([^\n]+)');
  IF v_match IS NOT NULL THEN
    RETURN 'TOO_FEW_CHUNKS:' || left(trim(v_match), 200);
  END IF;

  -- THRESHOLD_FAIL
  v_match := substring(v_err FROM 'THRESHOLD_FAIL[:\s]+([^\n]+)');
  IF v_match IS NOT NULL THEN
    RETURN 'THRESHOLD_FAIL:' || left(trim(v_match), 200);
  END IF;

  -- GATE_FAIL
  v_match := substring(v_err FROM 'GATE_FAIL:\s*([^\n]+)');
  IF v_match IS NOT NULL THEN
    RETURN 'GATE_FAIL:' || left(trim(v_match), 200);
  END IF;

  -- HTTP 500 deterministic
  IF v_err ILIKE '%HTTP 500%' OR v_err ILIKE '%Internal Server Error%' THEN
    RETURN 'HTTP_500:' || left(regexp_replace(v_err, '\s+', ' ', 'g'), 200);
  END IF;

  -- Fallback: erste 200 Zeichen ohne admin-cleanup-Suffix
  RETURN 'err:' || left(regexp_replace(v_err, '\s*\|\s*ADMIN_CLEANUP:.*$', ''), 200);
END;
$$;

-- 3) Hot-Loop-Quarantäne-Check (Post-Failure)
CREATE OR REPLACE FUNCTION public.fn_check_hot_loop_quarantine(
  p_package_id uuid,
  p_job_type text,
  p_window_minutes integer DEFAULT 30,
  p_threshold integer DEFAULT 5,
  p_block_minutes integer DEFAULT 30
)
RETURNS TABLE (quarantined boolean, signature text, fail_count integer, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz := now() - make_interval(mins => p_window_minutes);
  v_latest_sig text;
  v_identical_count integer;
  v_completes integer;
  v_reason text;
BEGIN
  IF p_package_id IS NULL OR p_job_type IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 0, NULL::text;
    RETURN;
  END IF;

  -- Skip wenn schon aktive Quarantäne
  IF EXISTS (
    SELECT 1 FROM public.package_job_quarantine
    WHERE package_id = p_package_id
      AND job_type = p_job_type
      AND cleared_at IS NULL
      AND blocked_until > now()
  ) THEN
    RETURN QUERY SELECT false, NULL::text, 0, 'already_quarantined'::text;
    RETURN;
  END IF;

  -- Letzte Signatur extrahieren
  SELECT public.fn_extract_failure_signature(jq.last_error::text)
    INTO v_latest_sig
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id
     AND jq.job_type = p_job_type
     AND jq.status = 'failed'
     AND jq.updated_at >= v_window_start
   ORDER BY jq.updated_at DESC
   LIMIT 1;

  IF v_latest_sig IS NULL OR v_latest_sig = 'OBSOLETE_RACE' THEN
    RETURN QUERY SELECT false, v_latest_sig, 0, 'no_real_failure'::text;
    RETURN;
  END IF;

  -- Identische Failure-Signaturen zählen
  SELECT COUNT(*)
    INTO v_identical_count
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id
     AND jq.job_type = p_job_type
     AND jq.status = 'failed'
     AND jq.updated_at >= v_window_start
     AND public.fn_extract_failure_signature(jq.last_error::text) = v_latest_sig;

  -- Completions im Fenster
  SELECT COUNT(*)
    INTO v_completes
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id
     AND jq.job_type = p_job_type
     AND jq.status = 'completed'
     AND jq.updated_at >= v_window_start;

  IF v_identical_count < p_threshold OR v_completes > 0 THEN
    RETURN QUERY SELECT false, v_latest_sig, v_identical_count, 'below_threshold'::text;
    RETURN;
  END IF;

  -- Quarantäne setzen
  v_reason := format('HOT_LOOP_BLOCKED: %s identical "%s" failures in %smin, 0 completes',
                     v_identical_count, v_latest_sig, p_window_minutes);

  INSERT INTO public.package_job_quarantine (
    package_id, job_type, failure_signature, identical_fail_count,
    reason, blocked_until, metadata
  ) VALUES (
    p_package_id, p_job_type, v_latest_sig, v_identical_count,
    v_reason,
    now() + make_interval(mins => p_block_minutes),
    jsonb_build_object(
      'window_minutes', p_window_minutes,
      'threshold', p_threshold,
      'block_minutes', p_block_minutes,
      'completes_in_window', v_completes
    )
  )
  ON CONFLICT (package_id, job_type) WHERE cleared_at IS NULL DO UPDATE
    SET failure_signature = EXCLUDED.failure_signature,
        identical_fail_count = EXCLUDED.identical_fail_count,
        reason = EXCLUDED.reason,
        blocked_until = EXCLUDED.blocked_until,
        metadata = EXCLUDED.metadata;

  -- Admin-Notification + Audit
  BEGIN
    INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES (
      format('🛑 Hot-Loop Quarantäne: %s – %s', p_job_type, substr(p_package_id::text, 1, 8)),
      v_reason,
      'pipeline', 'warning', 'package', p_package_id,
      jsonb_build_object('kind', 'hot_loop_claim_quarantine', 'job_type', p_job_type, 'signature', v_latest_sig)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'hot_loop_claim_quarantine', 'job_fail_post_check', 'package', p_package_id,
      'quarantined', v_reason,
      jsonb_build_object('job_type', p_job_type, 'signature', v_latest_sig, 'fail_count', v_identical_count)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN QUERY SELECT true, v_latest_sig, v_identical_count, v_reason;
END;
$$;

-- 4) Materialization-Routing: Jobs mit Mat-Guard-Fail werden cancelled, nicht failed
CREATE OR REPLACE FUNCTION public.fn_route_materialization_block(
  p_job_id uuid,
  p_last_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_mat_guard boolean;
BEGIN
  v_is_mat_guard := (
    p_last_error ILIKE '%MATERIALIZATION_GUARD%'
    OR p_last_error ILIKE '%TOO_FEW_CHUNKS%'
  );

  IF NOT v_is_mat_guard THEN
    RETURN false;
  END IF;

  UPDATE public.job_queue
     SET status = 'cancelled',
         last_error = format('BLOCKED_BY_MATERIALIZATION: %s', left(p_last_error, 400)),
         updated_at = now()
   WHERE id = p_job_id
     AND status IN ('processing', 'running', 'pending', 'batch_pending', 'failed');

  RETURN FOUND;
END;
$$;

-- 5) Beide Claim-RPCs: Quarantäne-Filter
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(
  p_job_types text[],
  p_limit integer,
  p_worker_id text,
  p_worker_pool text DEFAULT 'default'::text
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
AS $function$
BEGIN
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
      AND jq.job_type = ANY(p_job_types)
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
      -- Hot-Loop Quarantäne-Filter
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
    WHERE c.rn <= 3
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

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_worker_pool text DEFAULT NULL::text
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
      -- Hot-Loop Quarantäne-Filter
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

-- 6) Admin-View für aktive Quarantänen
CREATE OR REPLACE VIEW public.v_active_job_quarantines AS
SELECT
  q.id,
  q.package_id,
  cp.title AS package_title,
  q.job_type,
  q.failure_signature,
  q.identical_fail_count,
  q.reason,
  q.blocked_until,
  GREATEST(0, EXTRACT(EPOCH FROM (q.blocked_until - now())) / 60)::integer AS minutes_remaining,
  q.created_at,
  q.metadata
FROM public.package_job_quarantine q
LEFT JOIN public.course_packages cp ON cp.id = q.package_id
WHERE q.cleared_at IS NULL
  AND q.blocked_until > now()
ORDER BY q.blocked_until ASC;

GRANT SELECT ON public.v_active_job_quarantines TO authenticated;

-- 7) Admin-Funktion zum manuellen Aufheben
CREATE OR REPLACE FUNCTION public.admin_clear_job_quarantine(p_quarantine_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  UPDATE public.package_job_quarantine
     SET cleared_at = now(),
         cleared_by = auth.uid()::text
   WHERE id = p_quarantine_id
     AND cleared_at IS NULL;

  RETURN FOUND;
END;
$$;