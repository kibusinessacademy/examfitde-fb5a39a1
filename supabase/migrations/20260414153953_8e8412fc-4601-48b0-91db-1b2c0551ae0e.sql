
-- Fix 1: fn_auto_finalize_ready_steps — 'processing' → remove (only 'running','enqueued' valid)
CREATE OR REPLACE FUNCTION public.fn_auto_finalize_ready_steps()
 RETURNS TABLE(package_id uuid, step_key text, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT ps.package_id, ps.step_key,
      ps.metadata,
      (SELECT COUNT(*) FROM job_queue j 
       WHERE j.package_id = ps.package_id 
         AND j.job_type = ps.step_key 
         AND j.status IN ('pending','processing','running','batch_pending','enqueued')
      ) AS active_jobs,
      CASE
        WHEN (ps.metadata->>'completion_signal') IN ('batch_complete','ok') THEN true
        ELSE false
      END AS has_signal,
      CASE 
        WHEN ps.updated_at < now() - interval '10 minutes' THEN true
        ELSE false
      END AS is_old_enough
    FROM package_steps ps
    WHERE ps.status NOT IN ('done','skipped','not_started')
      AND ps.status IN ('running','enqueued')
  )
  SELECT c.package_id, c.step_key,
    'AUTO_FINALIZED: signal=' || COALESCE(c.metadata->>'completion_signal','none') AS reason
  FROM candidates c
  WHERE c.has_signal = true
    AND c.active_jobs = 0
    AND c.is_old_enough = true;
END;
$function$;

-- Fix 2: fn_rebalance_wip_priority — ps.status = 'processing' → 'running'
CREATE OR REPLACE FUNCTION public.fn_rebalance_wip_priority(p_max_demotions integer DEFAULT 3)
 RETURNS TABLE(demoted_package_id uuid, demoted_title text, demoted_priority integer, freed_for_priority integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_wip_cap INT;
    v_current_building INT;
    v_best_queued_priority INT;
    v_rec RECORD;
    v_min_progress_to_protect INT := 70;
    v_finalization_steps TEXT[] := ARRAY['quality_council', 'run_integrity_check', 'auto_publish'];
BEGIN
    SELECT COALESCE(value::int, 14) INTO v_wip_cap
    FROM ops_pipeline_config WHERE key = 'wip_total_cap';

    SELECT count(*) INTO v_current_building
    FROM course_packages WHERE status = 'building';

    SELECT min(priority) INTO v_best_queued_priority
    FROM course_packages WHERE status = 'queued' AND priority IS NOT NULL;

    IF v_best_queued_priority IS NULL THEN RETURN; END IF;
    IF v_current_building < v_wip_cap THEN RETURN; END IF;

    FOR v_rec IN
        SELECT cp.id, c.title, cp.priority, cp.build_progress
        FROM course_packages cp
        JOIN courses c ON c.id = cp.course_id
        WHERE cp.status = 'building'
          AND cp.priority > v_best_queued_priority
          AND cp.build_progress < v_min_progress_to_protect
          AND NOT EXISTS (
              SELECT 1 FROM package_steps ps
              WHERE ps.package_id = cp.id
                AND ps.step_key = ANY(v_finalization_steps)
                AND ps.status = 'running'
          )
        ORDER BY cp.priority DESC, cp.build_progress ASC, cp.updated_at ASC
        LIMIT p_max_demotions
    LOOP
        UPDATE job_queue SET status = 'cancelled', updated_at = now()
        WHERE package_id = v_rec.id AND status = 'pending';

        UPDATE course_packages SET status = 'queued', updated_at = now()
        WHERE id = v_rec.id;

        INSERT INTO admin_actions (action, scope, affected_ids, payload)
        VALUES ('wip_priority_rebalance', 'pipeline', ARRAY[v_rec.id::text],
            jsonb_build_object(
                'demoted_package', v_rec.id, 'demoted_title', v_rec.title,
                'demoted_priority', v_rec.priority, 'demoted_progress', v_rec.build_progress,
                'best_queued_priority', v_best_queued_priority,
                'wip_before', v_current_building, 'wip_cap', v_wip_cap,
                'version', 'v2_safe_demotion'
            ));

        v_current_building := v_current_building - 1;

        demoted_package_id := v_rec.id;
        demoted_title := v_rec.title;
        demoted_priority := v_rec.priority;
        freed_for_priority := v_best_queued_priority;
        RETURN NEXT;

        IF v_current_building < v_wip_cap THEN EXIT; END IF;
    END LOOP;
    RETURN;
END;
$function$;

-- Fix 3: release_stale_package_lease_v2 — ps.status IN (...'processing') → remove 'processing'
CREATE OR REPLACE FUNCTION public.release_stale_package_lease_v2(p_package_id uuid, p_reason text DEFAULT 'LEASE_NO_PROGRESS'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_alive_work boolean;
  v_deleted boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.status IN ('pending','processing')
      AND (
        jq.status = 'pending'
        OR COALESCE(jq.last_heartbeat_at, jq.updated_at, jq.locked_at, jq.started_at) > now() - interval '10 minutes'
      )
  ) INTO v_has_alive_work;

  IF v_has_alive_work THEN
    RETURN false;
  END IF;

  DELETE FROM public.package_leases
  WHERE package_id = p_package_id
    AND lease_until > now();

  v_deleted := FOUND;

  UPDATE public.package_steps ps
  SET
    status = 'queued',
    job_id = NULL,
    runner_id = NULL,
    started_at = NULL,
    last_error = left(COALESCE(ps.last_error, '') || ' | ' || p_reason, 1000),
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'lease_released_by_liveness', true,
      'lease_released_at', now(),
      'lease_release_reason', p_reason
    )
  WHERE ps.package_id = p_package_id
    AND ps.status IN ('running','enqueued')
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.id = ps.job_id
        AND jq.status IN ('pending','processing')
        AND COALESCE(jq.last_heartbeat_at, jq.updated_at) > now() - interval '10 minutes'
    );

  RETURN v_deleted;
END;
$function$;

-- Fix 4: fn_generate_package_forensic_report — 'processing' → 'running', 'pending' → 'queued'
CREATE OR REPLACE FUNCTION public.fn_generate_package_forensic_report(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record;
  v_report_id uuid;
  v_root_cause text := NULL;
  v_confidence numeric := 0;
  v_healability text := 'unknown';
  v_auto_heal boolean := false;
  v_summary text := '';
  v_report_type text := 'stalled_package';
  v_symptom jsonb := '{}'::jsonb;
  v_causal jsonb := '[]'::jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_jobs jsonb := '[]'::jsonb;
  v_artifact_state jsonb := '{}'::jsonb;
  v_governance jsonb := '{}'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_has_stale_jobs boolean := false;
  v_has_stuck_processing boolean := false;
  v_has_missing_upstream boolean := false;
  v_has_governance_block boolean := false;
  v_gate_class text;
  v_stale_count int := 0;
  v_processing_no_heartbeat int := 0;
  v_blocked_step_key text;
  v_blocking_step_key text;
BEGIN
  SELECT cp.id, cp.status, cp.build_status, cp.blocked_reason, cp.gate_class,
         cp.track, cp.curriculum_id, c.title as cert_title
  INTO v_pkg
  FROM course_packages cp
  LEFT JOIN certifications c ON c.id = cp.curriculum_id
  WHERE cp.id = p_package_id;

  IF v_pkg IS NULL THEN RETURN jsonb_build_object('error', 'Package not found'); END IF;
  v_gate_class := v_pkg.gate_class;

  UPDATE ops_forensic_reports SET status = 'superseded', updated_at = now()
  WHERE package_id = p_package_id AND status = 'open';

  SELECT jsonb_agg(jsonb_build_object(
    'step_key', ps.step_key, 'status', ps.status,
    'sort_order', ps.sort_order, 'last_error', ps.last_error, 'meta', ps.meta
  ) ORDER BY ps.sort_order) INTO v_steps
  FROM package_steps ps WHERE ps.package_id = p_package_id;

  SELECT jsonb_agg(jsonb_build_object(
    'job_type', jq.job_type, 'status', jq.status, 'locked_by', jq.locked_by,
    'last_error', jq.last_error, 'created_at', jq.created_at, 'updated_at', jq.updated_at,
    'attempts', jq.attempts,
    'hours_stale', EXTRACT(EPOCH FROM (now() - jq.updated_at)) / 3600.0
  )) INTO v_jobs
  FROM job_queue jq
  WHERE jq.payload->>'package_id' = p_package_id::text
    AND jq.status IN ('pending', 'processing', 'failed');

  SELECT count(*) INTO v_stale_count FROM job_queue jq
  WHERE jq.payload->>'package_id' = p_package_id::text
    AND jq.status = 'processing' AND jq.updated_at < now() - interval '30 minutes';
  v_has_stale_jobs := v_stale_count > 0;

  -- Steps in running without active jobs (was: 'processing' — invalid enum)
  SELECT count(*) INTO v_processing_no_heartbeat
  FROM package_steps ps WHERE ps.package_id = p_package_id AND ps.status = 'running'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      JOIN step_job_mapping sjm ON jq.job_type = ANY(sjm.job_types)
      WHERE sjm.step_key = ps.step_key
        AND jq.payload->>'package_id' = p_package_id::text
        AND jq.status = 'processing' AND jq.updated_at > now() - interval '30 minutes'
    );
  v_has_stuck_processing := v_processing_no_heartbeat > 0;

  v_has_governance_block := (v_pkg.status = 'blocked' OR v_pkg.blocked_reason IS NOT NULL);
  v_governance := jsonb_build_object(
    'package_status', v_pkg.status,
    'blocked_reason', v_pkg.blocked_reason,
    'gate_class', v_gate_class
  );

  -- Check missing upstream: 'pending'/'processing' → 'queued'/'running' (valid enum)
  SELECT EXISTS(
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.status IN ('queued', 'running', 'enqueued')
      AND EXISTS (
        SELECT 1 FROM package_steps pred
        WHERE pred.package_id = p_package_id
          AND pred.status NOT IN ('done', 'skipped')
          AND pred.sort_order = (
            SELECT MAX(p2.sort_order) FROM package_steps p2
            WHERE p2.package_id = p_package_id AND p2.sort_order < ps.sort_order
          )
      )
  ) INTO v_has_missing_upstream;

  SELECT ps.step_key, pred.step_key
  INTO v_blocked_step_key, v_blocking_step_key
  FROM package_steps ps
  JOIN LATERAL (
    SELECT p2.step_key, p2.status FROM package_steps p2
    WHERE p2.package_id = p_package_id
      AND p2.sort_order = (
        SELECT MAX(p3.sort_order) FROM package_steps p3
        WHERE p3.package_id = p_package_id AND p3.sort_order < ps.sort_order
      )
  ) pred ON pred.status NOT IN ('done', 'skipped')
  WHERE ps.package_id = p_package_id
    AND ps.status IN ('queued', 'running', 'enqueued')
  ORDER BY ps.sort_order
  LIMIT 1;

  v_artifact_state := jsonb_build_object(
    'has_stale_jobs', v_has_stale_jobs, 'stale_job_count', v_stale_count,
    'processing_without_heartbeat', v_processing_no_heartbeat,
    'has_governance_block', v_has_governance_block,
    'has_missing_upstream', v_has_missing_upstream,
    'blocked_step', v_blocked_step_key,
    'blocking_step', v_blocking_step_key
  );
  v_symptom := jsonb_build_object(
    'package_status', v_pkg.status, 'cert_title', v_pkg.cert_title,
    'track', v_pkg.track, 'stale_jobs', v_stale_count,
    'stuck_processing_steps', v_processing_no_heartbeat,
    'blocked_step', v_blocked_step_key,
    'blocking_step', v_blocking_step_key
  );

  IF v_has_governance_block THEN
    v_root_cause := 'GOVERNANCE_BLOCK'; v_confidence := 0.9;
    v_report_type := 'governance_conflict';
    v_healability := 'manual_review';
    v_summary := format('Package blocked: %s', COALESCE(v_pkg.blocked_reason, 'unbekannt'));
  ELSIF v_gate_class IN ('terminal', 'hard_fail') THEN
    v_root_cause := 'QUALITY_GATE_BLOCK'; v_confidence := 0.85;
    v_report_type := 'blocked_step';
    v_healability := 'hard_blocked';
    v_summary := format('Quality Gate terminal (%s)', COALESCE(v_gate_class, '?'));
  ELSIF v_has_stale_jobs AND v_has_governance_block THEN
    v_root_cause := 'STALE_LOCK_FALSE_ACTIVE'; v_confidence := 0.7;
    v_report_type := 'false_liveness';
    v_healability := 'manual_review';
    v_summary := format('%s stale Jobs + Governance-Block', v_stale_count);
  ELSIF v_has_stale_jobs AND v_has_missing_upstream THEN
    v_root_cause := 'STALE_LOCK_FALSE_ACTIVE'; v_confidence := 0.7;
    v_report_type := 'false_liveness';
    v_healability := 'manual_review';
    v_summary := format('%s stale Jobs + Upstream-Block (%s wartet auf %s)',
      v_stale_count, COALESCE(v_blocked_step_key,'?'), COALESCE(v_blocking_step_key,'?'));
  ELSIF v_has_stale_jobs AND NOT v_has_governance_block AND NOT v_has_missing_upstream THEN
    v_root_cause := 'STALE_LOCK_FALSE_ACTIVE'; v_confidence := 0.85;
    v_report_type := 'false_liveness';
    v_healability := 'auto_healable';
    v_auto_heal := true;
    v_summary := format('%s stale Jobs — Auto-Heal möglich', v_stale_count);
  ELSIF v_has_stuck_processing AND v_has_missing_upstream THEN
    v_root_cause := 'UPSTREAM_VARIANTS_MISSING'; v_confidence := 0.7;
    v_report_type := 'materialization_failure';
    v_healability := 'manual_review';
    v_summary := format('Processing ohne Jobs — %s wartet auf %s',
      COALESCE(v_blocked_step_key,'?'), COALESCE(v_blocking_step_key,'?'));
  ELSIF v_has_stuck_processing THEN
    v_root_cause := 'UNKNOWN_NEEDS_MANUAL_REVIEW'; v_confidence := 0.4;
    v_report_type := 'queue_mismatch';
    v_healability := 'manual_review';
    v_summary := 'Processing ohne aktive Jobs — Ursache unklar';
  ELSIF v_pkg.status = 'building' AND (v_jobs IS NULL OR jsonb_array_length(COALESCE(v_jobs,'[]'::jsonb)) = 0) THEN
    IF v_has_missing_upstream THEN
      v_root_cause := 'UPSTREAM_VARIANTS_MISSING'; v_confidence := 0.6;
      v_summary := format('Building ohne Jobs — %s wartet auf %s',
        COALESCE(v_blocked_step_key,'?'), COALESCE(v_blocking_step_key,'?'));
    ELSE
      v_root_cause := 'UNKNOWN_NEEDS_MANUAL_REVIEW'; v_confidence := 0.3;
      v_summary := 'Package building ohne Jobs — nicht klassifizierbar';
    END IF;
    v_healability := 'manual_review';
    v_report_type := 'stalled_package';
  ELSE
    v_root_cause := 'UNKNOWN_NEEDS_MANUAL_REVIEW'; v_confidence := 0.2;
    v_healability := 'unknown';
    v_summary := 'Anomalie — nicht klassifizierbar';
  END IF;

  v_causal := '[]'::jsonb;
  IF v_root_cause IS NOT NULL THEN
    v_causal := v_causal || jsonb_build_array(jsonb_build_object(
      'type', 'root_cause', 'code', v_root_cause,
      'step', v_blocking_step_key,
      'evidence', v_artifact_state
    ));
  END IF;
  IF v_has_missing_upstream AND v_blocked_step_key IS NOT NULL THEN
    v_causal := v_causal || jsonb_build_array(jsonb_build_object(
      'type', 'downstream_effect', 'code', 'BLOCKED_BY_UPSTREAM',
      'step', v_blocked_step_key,
      'blocked_by', v_blocking_step_key,
      'evidence', jsonb_build_object('blocked_step', v_blocked_step_key, 'blocking_step', v_blocking_step_key)
    ));
  END IF;
  IF v_has_stale_jobs THEN
    v_causal := v_causal || jsonb_build_array(jsonb_build_object(
      'type', 'surface_symptom', 'code', 'STALE_PROCESSING_JOBS',
      'evidence', jsonb_build_object('count', v_stale_count)
    ));
  END IF;
  IF v_has_stuck_processing THEN
    v_causal := v_causal || jsonb_build_array(jsonb_build_object(
      'type', 'surface_symptom', 'code', 'STEPS_WITHOUT_ACTIVE_JOBS',
      'evidence', jsonb_build_object('count', v_processing_no_heartbeat)
    ));
  END IF;

  v_actions := '[]'::jsonb;
  IF v_has_stale_jobs AND v_auto_heal THEN
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'action_code', 'RECLAIM_STALE_JOBS',
      'description', format('Reset %s stale Jobs', v_stale_count),
      'safety_level', 'safe', 'auto_allowed', true,
      'why', 'Kein Governance-/Upstream-Block'
    ));
  ELSIF v_has_stale_jobs THEN
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'action_code', 'REVIEW_STALE_JOBS',
      'description', format('%s stale Jobs manuell prüfen', v_stale_count),
      'safety_level', 'manual_only', 'auto_allowed', false,
      'why', 'Governance/Upstream-Block vorhanden'
    ));
  END IF;
  IF v_has_missing_upstream THEN
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'action_code', 'FIX_UPSTREAM_ARTIFACT',
      'description', format('Upstream-Schritt %s abschließen', COALESCE(v_blocking_step_key, '?')),
      'safety_level', 'requires_investigation', 'auto_allowed', false,
      'why', format('%s wartet auf %s', COALESCE(v_blocked_step_key,'?'), COALESCE(v_blocking_step_key,'?'))
    ));
  END IF;
  IF v_has_governance_block THEN
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'action_code', 'REVIEW_GOVERNANCE_STATE',
      'description', format('Block prüfen: %s', COALESCE(v_pkg.blocked_reason, '?')),
      'safety_level', 'manual_only', 'auto_allowed', false,
      'why', 'Governance-Block aktiv'
    ));
  END IF;

  INSERT INTO ops_forensic_reports (
    package_id, report_type, status, summary,
    root_cause_class, root_cause_confidence,
    symptom_snapshot, causal_chain, impacted_steps, impacted_jobs,
    artifact_state, governance_state,
    healability, auto_heal_allowed, recommended_actions
  ) VALUES (
    p_package_id, v_report_type, 'open', v_summary,
    v_root_cause, v_confidence, v_symptom, v_causal,
    COALESCE(v_steps, '[]'::jsonb), COALESCE(v_jobs, '[]'::jsonb),
    v_artifact_state, v_governance,
    v_healability, v_auto_heal, v_actions
  ) RETURNING id INTO v_report_id;

  IF v_root_cause IS NOT NULL THEN
    INSERT INTO ops_forensic_findings (report_id, finding_type, severity, code, title, details)
    VALUES (v_report_id, 'root_cause',
      CASE WHEN v_healability = 'hard_blocked' THEN 'critical'
           WHEN v_healability = 'manual_review' THEN 'warning'
           ELSE 'info' END,
      v_root_cause, v_summary, v_artifact_state);
  END IF;
  IF v_has_stale_jobs THEN
    INSERT INTO ops_forensic_findings (report_id, finding_type, severity, code, title, details)
    VALUES (v_report_id, 'symptom', 'warning', 'STALE_PROCESSING_JOBS',
      format('%s stale Jobs (>30 min)', v_stale_count),
      jsonb_build_object('count', v_stale_count));
  END IF;
  IF v_has_stuck_processing THEN
    INSERT INTO ops_forensic_findings (report_id, finding_type, severity, code, title, details)
    VALUES (v_report_id, 'symptom', 'warning', 'STEPS_WITHOUT_ACTIVE_JOBS',
      format('%s Steps in running ohne aktive Jobs', v_processing_no_heartbeat),
      jsonb_build_object('count', v_processing_no_heartbeat));
  END IF;
  IF v_has_missing_upstream AND v_blocked_step_key IS NOT NULL THEN
    INSERT INTO ops_forensic_findings (report_id, finding_type, severity, code, title, details)
    VALUES (v_report_id, 'supporting_evidence', 'info', 'UPSTREAM_DEPENDENCY_CHAIN',
      format('%s blockiert durch %s', v_blocked_step_key, v_blocking_step_key),
      jsonb_build_object('blocked_step', v_blocked_step_key, 'blocking_step', v_blocking_step_key));
  END IF;

  RETURN jsonb_build_object(
    'report_id', v_report_id,
    'root_cause', v_root_cause,
    'confidence', v_confidence,
    'healability', v_healability,
    'auto_heal', v_auto_heal,
    'summary', v_summary,
    'blocked_step', v_blocked_step_key,
    'blocking_step', v_blocking_step_key
  );
END;
$function$;
