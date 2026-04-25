-- ============================================================
-- 1) RETRY GUARD: Smart-Repair für fehlende Vorgänger-Artefakte
-- ============================================================
-- Erkennt step-spezifische "Vorgänger hat nichts produziert"-Fehler
-- und (a) parkt den abhängigen Job 24h, (b) enqueued einen Repair-Vorgänger.

CREATE OR REPLACE FUNCTION public.fn_retry_guard_smart_repair()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_key text;
  v_prereq_step text;
  v_prereq_job_type text;
  v_park_signature text;
  v_existing_repair int;
  v_should_park boolean := false;
BEGIN
  -- Nur prüfen wenn pending mit attempts >= 3 und last_error gesetzt
  IF NEW.status <> 'pending' OR COALESCE(NEW.attempts,0) < 3 OR NEW.last_error IS NULL THEN
    RETURN NEW;
  END IF;

  -- bereits geparkt? skip
  IF NEW.last_error LIKE 'PARKED_AWAITING_PRECONDITION%' THEN
    RETURN NEW;
  END IF;

  -- Step-Key aus job_type ableiten (package_<step>)
  v_step_key := regexp_replace(NEW.job_type, '^package_', '');
  v_prereq_step := public.get_step_prerequisite(v_step_key);

  IF v_prereq_step IS NULL THEN
    RETURN NEW;
  END IF;

  -- Signaturen für "Vorgänger hat nichts produziert"
  v_should_park := (
    NEW.last_error ILIKE '%NO_MINICHECKS%'
    OR NEW.last_error ILIKE '%PREREQ_NOT_DONE%'
    OR NEW.last_error ILIKE '%MISSING_SOURCE_DATA%'
    OR NEW.last_error ILIKE '%NO_BLUEPRINT%'
    OR NEW.last_error ILIKE '%NO_LESSONS%'
    OR NEW.last_error ILIKE '%COVERAGE_GAP%'
    OR NEW.last_error ILIKE '%HTTP 500%' AND NEW.attempts >= 5
  );

  IF NOT v_should_park THEN
    RETURN NEW;
  END IF;

  v_park_signature := format('smart_repair_%s_%s', v_step_key, v_prereq_step);

  -- Prüfen ob Vorgänger-Repair-Job bereits enqueued (idempotent)
  v_prereq_job_type := 'package_' || v_prereq_step;
  SELECT COUNT(*) INTO v_existing_repair
  FROM job_queue
  WHERE package_id = NEW.package_id
    AND job_type = v_prereq_job_type
    AND status IN ('pending','processing')
    AND created_at > now() - interval '1 hour';

  -- Park current job 24h
  NEW.run_after := now() + interval '24 hours';
  NEW.last_error := 'PARKED_AWAITING_PRECONDITION: ' || v_prereq_step || ' must produce artifacts | ' || COALESCE(NEW.last_error, '');
  NEW.last_error_code := 'PARKED_PREREQ_NO_OUTPUT';
  NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
    'parked_at', now()::text,
    'parked_by', 'fn_retry_guard_smart_repair',
    'park_signature', v_park_signature,
    'missing_prereq', v_prereq_step,
    'smart_repair_enqueued', (v_existing_repair = 0)
  );

  -- Enqueue Vorgänger-Repair wenn nicht bereits aktiv
  IF v_existing_repair = 0 THEN
    BEGIN
      INSERT INTO job_queue (
        job_type, package_id, status, priority, run_after, payload,
        idempotency_key, lane, meta
      ) VALUES (
        v_prereq_job_type, NEW.package_id, 'pending', 80, now(),
        jsonb_build_object('package_id', NEW.package_id, 'reason', 'smart_repair_triggered_by_' || v_step_key),
        format('smart_repair_%s_%s_%s', NEW.package_id, v_prereq_step, to_char(now(),'YYYYMMDDHH24')),
        'recovery',
        jsonb_build_object(
          'triggered_by_smart_repair', true,
          'downstream_job_id', NEW.id,
          'downstream_step', v_step_key
        )
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- Park bleibt auch ohne Repair-Enqueue gültig
      NULL;
    END;
  END IF;

  -- Audit
  INSERT INTO admin_notifications (severity, category, title, body, metadata)
  VALUES ('warning', 'pipeline_ops',
    format('Retry Guard: Job %s geparkt (Vorgänger %s fehlt)', NEW.job_type, v_prereq_step),
    format('Job %s wurde nach %s Versuchen geparkt; Smart-Repair für %s %s.',
      substring(NEW.id::text,1,8), NEW.attempts, v_prereq_step,
      CASE WHEN v_existing_repair = 0 THEN 'enqueued' ELSE 'bereits aktiv' END),
    jsonb_build_object(
      'job_id', NEW.id::text,
      'package_id', NEW.package_id,
      'step', v_step_key,
      'prereq_step', v_prereq_step,
      'attempts', NEW.attempts,
      'park_until', (now() + interval '24 hours')::text
    ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retry_guard_smart_repair ON job_queue;
CREATE TRIGGER trg_retry_guard_smart_repair
BEFORE UPDATE ON job_queue
FOR EACH ROW
WHEN (NEW.status = 'pending' AND NEW.attempts >= 3)
EXECUTE FUNCTION public.fn_retry_guard_smart_repair();

-- ============================================================
-- 2) STALE-DIFF-REPORT VIEW
-- ============================================================
CREATE OR REPLACE VIEW public.v_admin_stale_marker_diff AS
WITH pkg AS (
  SELECT 
    cp.id AS package_id,
    cp.title,
    cp.status::text AS pkg_status,
    cp.is_published,
    cp.blocked_reason,
    cp.build_progress,
    (cp.integrity_report->'v3'->>'score')::numeric AS integrity_score
  FROM course_packages cp
),
steps AS (
  SELECT 
    ps.package_id,
    COUNT(*) FILTER (WHERE ps.status::text IN ('queued','pending','running')) AS open_steps,
    COUNT(*) FILTER (WHERE ps.status::text = 'failed') AS failed_steps,
    COUNT(*) FILTER (WHERE ps.meta::text ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%') AS exhaustion_markers,
    COUNT(*) FILTER (WHERE ps.meta->>'guard_state' = 'hard_stalled') AS hard_stalled_steps,
    COUNT(*) FILTER (WHERE ps.meta->>'terminal_escalation' = 'true') AS terminal_escalations,
    MAX(ps.updated_at) AS last_step_update
  FROM package_steps ps
  GROUP BY ps.package_id
),
jobs AS (
  SELECT 
    jq.package_id,
    COUNT(*) FILTER (WHERE jq.status IN ('pending','processing')) AS active_jobs,
    COUNT(*) FILTER (WHERE jq.last_error LIKE 'PARKED_AWAITING_PRECONDITION%') AS parked_jobs,
    COUNT(*) FILTER (WHERE jq.status = 'failed') AS failed_jobs
  FROM job_queue jq
  GROUP BY jq.package_id
)
SELECT 
  p.package_id,
  p.title,
  p.pkg_status,
  p.is_published,
  p.blocked_reason,
  p.build_progress,
  p.integrity_score,
  COALESCE(s.open_steps, 0) AS open_steps,
  COALESCE(s.failed_steps, 0) AS failed_steps,
  COALESCE(s.exhaustion_markers, 0) AS exhaustion_markers,
  COALESCE(s.hard_stalled_steps, 0) AS hard_stalled_steps,
  COALESCE(s.terminal_escalations, 0) AS terminal_escalations,
  COALESCE(j.active_jobs, 0) AS active_jobs,
  COALESCE(j.parked_jobs, 0) AS parked_jobs,
  COALESCE(j.failed_jobs, 0) AS failed_jobs,
  s.last_step_update,
  -- Drift-Klassifikation
  CASE
    WHEN p.is_published = true AND COALESCE(s.exhaustion_markers,0) > 0 AND COALESCE(s.open_steps,0) = 0
      THEN 'STALE_EXHAUSTION_PUBLISHED'
    WHEN p.pkg_status = 'published' AND p.is_published = false
      THEN 'GHOST_PUBLISHED_FLAG_MISMATCH'
    WHEN p.pkg_status = 'published' AND COALESCE(s.exhaustion_markers,0) > 0 AND COALESCE(s.open_steps,0) = 0
      THEN 'STALE_EXHAUSTION_NO_OPEN_STEPS'
    WHEN p.pkg_status = 'building' AND COALESCE(s.open_steps,0) = 0 AND COALESCE(j.active_jobs,0) = 0
      THEN 'ORPHAN_BUILDING_NO_PROGRESS'
    WHEN p.pkg_status = 'blocked' AND COALESCE(s.exhaustion_markers,0) = 0 AND COALESCE(s.failed_steps,0) = 0
      THEN 'GHOST_BLOCKED_NO_FAILURE'
    WHEN COALESCE(j.parked_jobs,0) > 0
      THEN 'PARKED_AWAITING_PREREQ'
    WHEN COALESCE(s.exhaustion_markers,0) > 0 AND COALESCE(s.open_steps,0) > 0
      THEN 'EXHAUSTED_BUT_STILL_RUNNING'
    ELSE 'CLEAN'
  END AS drift_class,
  -- Empfohlene Aktion
  CASE
    WHEN p.is_published = true AND COALESCE(s.exhaustion_markers,0) > 0 AND COALESCE(s.open_steps,0) = 0
      THEN 'purge_stale_exhaustion'
    WHEN p.pkg_status = 'published' AND p.is_published = false
      THEN 'sync_published_flag'
    WHEN p.pkg_status = 'building' AND COALESCE(s.open_steps,0) = 0 AND COALESCE(j.active_jobs,0) = 0
      THEN 'enqueue_next_step_or_finalize'
    WHEN COALESCE(j.parked_jobs,0) > 0
      THEN 'await_prereq_or_manual_unpark'
    ELSE 'none'
  END AS recommended_action
FROM pkg p
LEFT JOIN steps s ON s.package_id = p.package_id
LEFT JOIN jobs j ON j.package_id = p.package_id;

-- ============================================================
-- 3) VORBEDINGUNGS-CHECK-VIEW
-- ============================================================
CREATE OR REPLACE VIEW public.v_admin_action_precondition_check AS
SELECT 
  cp.id AS package_id,
  cp.title,
  cp.status::text AS pkg_status,
  -- Aktive Jobs (running/processing)
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'job_id', jq.id,
    'job_type', jq.job_type,
    'status', jq.status,
    'attempts', jq.attempts,
    'started_at', jq.started_at,
    'last_error', substring(COALESCE(jq.last_error,''),1,120)
  )) FROM job_queue jq 
  WHERE jq.package_id = cp.id 
    AND jq.status IN ('pending','processing')
    AND (jq.last_error IS NULL OR jq.last_error NOT LIKE 'PARKED_AWAITING_PRECONDITION%')
  ), '[]'::jsonb) AS active_jobs,
  -- Geparkte Jobs
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'job_id', jq.id,
    'job_type', jq.job_type,
    'park_until', jq.run_after,
    'reason', substring(COALESCE(jq.last_error,''),1,120),
    'attempts', jq.attempts
  )) FROM job_queue jq 
  WHERE jq.package_id = cp.id 
    AND jq.status = 'pending' 
    AND jq.last_error LIKE 'PARKED_AWAITING_PRECONDITION%'
  ), '[]'::jsonb) AS parked_jobs,
  -- Aktive kritische Schritte
  EXISTS (
    SELECT 1 FROM job_queue jq 
    WHERE jq.package_id = cp.id 
      AND jq.status IN ('pending','processing')
      AND jq.job_type IN ('package_run_integrity_check','package_quality_council','package_validate_exam_pool','package_repair_exam_pool_quality')
      AND (jq.last_error IS NULL OR jq.last_error NOT LIKE 'PARKED_AWAITING_PRECONDITION%')
  ) AS critical_job_running,
  -- Sollten Aktionen blockiert sein?
  CASE
    WHEN EXISTS (
      SELECT 1 FROM job_queue jq 
      WHERE jq.package_id = cp.id 
        AND jq.status = 'processing'
    ) THEN 'block_actions_processing'
    WHEN EXISTS (
      SELECT 1 FROM job_queue jq 
      WHERE jq.package_id = cp.id 
        AND jq.status IN ('pending','processing')
        AND jq.job_type IN ('package_run_integrity_check','package_quality_council','package_repair_hardish_balance')
        AND (jq.last_error IS NULL OR jq.last_error NOT LIKE 'PARKED_AWAITING_PRECONDITION%')
    ) THEN 'block_actions_critical_job_pending'
    ELSE 'allow_actions'
  END AS action_state,
  now() AS as_of
FROM course_packages cp;

-- ============================================================
-- 4) EXHAUSTION-CLEANUP RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_purge_stale_exhaustion(
  p_package_id uuid DEFAULT NULL,  -- NULL = alle stale Pakete bereinigen
  p_trigger_refill boolean DEFAULT false
)
RETURNS TABLE(
  package_id uuid,
  title text,
  prev_drift_class text,
  steps_cleared int,
  refill_enqueued boolean,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_cleared int;
  v_refill_job text;
  v_enqueued boolean;
BEGIN
  FOR r IN
    SELECT *
    FROM v_admin_stale_marker_diff d
    WHERE d.drift_class IN ('STALE_EXHAUSTION_PUBLISHED','STALE_EXHAUSTION_NO_OPEN_STEPS')
      AND d.active_jobs = 0
      AND (p_package_id IS NULL OR d.package_id = p_package_id)
  LOOP
    -- Marker bereinigen
    UPDATE package_steps
    SET meta = (meta - 'terminal_escalation' - 'auto_heal_skipped_at' - 'reason_codes'
        - 'last_error' - 'gate_status' - 'failed_at' - 'failure_stage'
        - 'consecutive_no_progress' - 'stall_reason_code' - 'last_guard_action'
        - 'skip_reason' - 'pkg_status_at_skip')
      || jsonb_build_object(
        'guard_state', 'pass_ready',
        'cleared_at', now()::text,
        'cleared_by', 'admin_purge_stale_exhaustion',
        'cleared_reason', format('drift_class_%s_no_active_jobs', r.drift_class)
      )
    WHERE package_id = r.package_id
      AND meta::text ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%';

    GET DIAGNOSTICS v_cleared = ROW_COUNT;

    -- Optional Refill triggern
    v_enqueued := false;
    v_refill_job := NULL;
    IF p_trigger_refill AND r.is_published = false AND r.pkg_status = 'building' THEN
      v_refill_job := 'package_run_integrity_check';
      INSERT INTO job_queue (job_type, package_id, status, priority, run_after, payload, idempotency_key, lane)
      VALUES (
        v_refill_job, r.package_id, 'pending', 70, now(),
        jsonb_build_object('package_id', r.package_id, 'reason', 'post_exhaustion_purge_refill'),
        format('post_purge_refill_%s_%s', r.package_id, to_char(now(),'YYYYMMDDHH24')),
        'recovery'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_enqueued := true;
    END IF;

    package_id := r.package_id;
    title := r.title;
    prev_drift_class := r.drift_class;
    steps_cleared := v_cleared;
    refill_enqueued := v_enqueued;
    outcome := CASE 
      WHEN v_cleared > 0 AND v_enqueued THEN 'cleared_and_refill_enqueued'
      WHEN v_cleared > 0 THEN 'cleared_no_refill'
      ELSE 'no_markers_found'
    END;
    RETURN NEXT;
  END LOOP;

  -- Audit
  INSERT INTO admin_notifications (severity, category, title, body, metadata)
  VALUES ('info', 'pipeline_ops',
    'Stale Exhaustion Cleanup ausgeführt',
    format('Purge ausgeführt für package_id=%s, refill=%s', COALESCE(p_package_id::text,'ALL'), p_trigger_refill),
    jsonb_build_object('triggered_by','admin_purge_stale_exhaustion','at',now()::text));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_purge_stale_exhaustion(uuid, boolean) TO authenticated;

-- ============================================================
-- 5) MANUAL-BLOCK ÜBERSICHT (Auto vs Manuell)
-- ============================================================
CREATE OR REPLACE VIEW public.v_admin_blocked_packages_split AS
SELECT 
  cp.id AS package_id,
  cp.title,
  cp.status::text AS pkg_status,
  cp.blocked_reason,
  cp.is_published,
  -- Manuell blockiert wenn: blocked_reason set OR manual_bypass=true OR terminal_escalation
  CASE
    WHEN cp.blocked_reason IS NOT NULL AND cp.blocked_reason ILIKE '%admin%' THEN 'manual'
    WHEN EXISTS (
      SELECT 1 FROM package_steps ps 
      WHERE ps.package_id = cp.id 
        AND (ps.meta->>'manual_bypass' = 'true' 
          OR ps.meta->>'terminal_escalation' = 'true'
          OR ps.meta::text ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%')
    ) THEN 'manual'
    WHEN cp.status = 'blocked' THEN 'auto'
    ELSE 'none'
  END AS block_class,
  -- Sperr-Grund
  COALESCE(
    cp.blocked_reason,
    (SELECT ps.last_error FROM package_steps ps 
     WHERE ps.package_id = cp.id AND ps.status::text = 'failed'
     ORDER BY ps.updated_at DESC LIMIT 1),
    (SELECT ps.meta->>'last_error' FROM package_steps ps 
     WHERE ps.package_id = cp.id AND ps.meta ? 'last_error'
     ORDER BY ps.updated_at DESC LIMIT 1),
    'unknown'
  ) AS block_reason_text,
  -- Nächster empfohlener Schritt
  CASE
    WHEN EXISTS (
      SELECT 1 FROM package_steps ps WHERE ps.package_id = cp.id 
        AND ps.meta::text ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
        AND NOT EXISTS (
          SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id 
            AND jq.status IN ('pending','processing')
        )
    ) THEN 'purge_stale_exhaustion'
    WHEN cp.status = 'blocked' AND cp.blocked_reason ILIKE '%curriculum%' THEN 'manual_curriculum_review'
    WHEN cp.status = 'blocked' AND cp.blocked_reason ILIKE '%coverage%' THEN 'targeted_competency_fill'
    WHEN cp.status = 'blocked' THEN 'manual_review'
    ELSE 'none'
  END AS next_step_cta,
  (SELECT COUNT(*) FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','processing')) AS active_jobs,
  cp.updated_at
FROM course_packages cp
WHERE cp.status IN ('blocked','building','queued')
   OR cp.blocked_reason IS NOT NULL;

GRANT SELECT ON public.v_admin_stale_marker_diff TO authenticated;
GRANT SELECT ON public.v_admin_action_precondition_check TO authenticated;
GRANT SELECT ON public.v_admin_blocked_packages_split TO authenticated;