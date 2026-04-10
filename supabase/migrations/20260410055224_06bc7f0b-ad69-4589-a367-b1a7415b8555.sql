
-- ═══════════════════════════════════════════════════════════════
-- Delta-Härtung: Views droppen + neu erstellen, v_has_missing_upstream präzisieren
-- ═══════════════════════════════════════════════════════════════

-- 1. Drop ALL forensic views (CASCADE handles dependencies)
DROP VIEW IF EXISTS public.ops_exam_pool_promotion_blocked CASCADE;
DROP VIEW IF EXISTS public.ops_hard_blocked_reports CASCADE;
DROP VIEW IF EXISTS public.ops_auto_healable_reports CASCADE;
DROP VIEW IF EXISTS public.ops_open_forensic_reports CASCADE;

-- 2. Hardened fn_generate_package_forensic_report
--    Key change: v_has_missing_upstream now checks the IMMEDIATE predecessor
--    of each non-terminal step, not "any earlier step". This prevents
--    overly broad UPSTREAM_VARIANTS_MISSING classification.
CREATE OR REPLACE FUNCTION public.fn_generate_package_forensic_report(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- Supersede previous open reports for this package
  UPDATE ops_forensic_reports SET status = 'superseded', updated_at = now()
  WHERE package_id = p_package_id AND status = 'open';

  -- Collect steps
  SELECT jsonb_agg(jsonb_build_object(
    'step_key', ps.step_key, 'status', ps.status,
    'sort_order', ps.sort_order, 'last_error', ps.last_error, 'meta', ps.meta
  ) ORDER BY ps.sort_order) INTO v_steps
  FROM package_steps ps WHERE ps.package_id = p_package_id;

  -- Collect jobs via step_job_mapping (no LIKE)
  SELECT jsonb_agg(jsonb_build_object(
    'job_type', jq.job_type, 'status', jq.status, 'locked_by', jq.locked_by,
    'last_error', jq.last_error, 'created_at', jq.created_at, 'updated_at', jq.updated_at,
    'attempts', jq.attempts,
    'hours_stale', EXTRACT(EPOCH FROM (now() - jq.updated_at)) / 3600.0
  )) INTO v_jobs
  FROM job_queue jq
  WHERE jq.payload->>'package_id' = p_package_id::text
    AND jq.status IN ('pending', 'processing', 'failed');

  -- Stale jobs: processing + no update > 30min
  SELECT count(*) INTO v_stale_count FROM job_queue jq
  WHERE jq.payload->>'package_id' = p_package_id::text
    AND jq.status = 'processing' AND jq.updated_at < now() - interval '30 minutes';
  v_has_stale_jobs := v_stale_count > 0;

  -- Steps in processing without active jobs
  SELECT count(*) INTO v_processing_no_heartbeat
  FROM package_steps ps WHERE ps.package_id = p_package_id AND ps.status = 'processing'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      JOIN step_job_mapping sjm ON jq.job_type = ANY(sjm.job_types)
      WHERE sjm.step_key = ps.step_key
        AND jq.payload->>'package_id' = p_package_id::text
        AND jq.status = 'processing' AND jq.updated_at > now() - interval '30 minutes'
    );
  v_has_stuck_processing := v_processing_no_heartbeat > 0;

  -- Governance block
  v_has_governance_block := (v_pkg.status = 'blocked' OR v_pkg.blocked_reason IS NOT NULL);
  v_governance := jsonb_build_object(
    'package_status', v_pkg.status,
    'blocked_reason', v_pkg.blocked_reason,
    'gate_class', v_gate_class
  );

  -- ══ HARDENED v_has_missing_upstream ══
  -- Instead of "any earlier step not done", check if a non-terminal step
  -- has its IMMEDIATE predecessor (max sort_order < current) NOT terminal.
  -- This gives precise "which step blocks which" info.
  SELECT EXISTS(
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.status IN ('pending', 'processing', 'queued')
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

  -- Also capture WHICH steps are blocked by WHICH
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
    AND ps.status IN ('pending', 'processing', 'queued')
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

  -- ══ ROOT CAUSE CLASSIFICATION (hardened) ══
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
    -- Conservative: don't claim QUEUE_POLICY_MISMATCH without more evidence
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

  -- ══ CAUSAL CHAIN ══
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

  -- ══ RECOMMENDED ACTIONS ══
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

  -- ══ INSERT REPORT ══
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

  -- ══ INSERT FINDINGS ══
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
      format('%s Steps in processing ohne aktive Jobs', v_processing_no_heartbeat),
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
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. Recreate all forensic views
-- ═══════════════════════════════════════════════════════════════

CREATE VIEW public.ops_open_forensic_reports AS
SELECT r.id, r.package_id, r.report_type, r.status, r.summary,
       r.root_cause_class, r.root_cause_confidence,
       r.symptom_snapshot, r.causal_chain, r.impacted_steps, r.impacted_jobs,
       r.artifact_state, r.lease_state, r.governance_state,
       r.healability, r.auto_heal_allowed, r.recommended_actions,
       r.created_at, r.updated_at,
       c.title as cert_title, c.slug as cert_slug
FROM ops_forensic_reports r
LEFT JOIN course_packages cp ON cp.id = r.package_id
LEFT JOIN certifications c ON c.id = cp.curriculum_id
WHERE r.status = 'open'
ORDER BY
  CASE r.healability
    WHEN 'hard_blocked' THEN 1
    WHEN 'manual_review' THEN 2
    WHEN 'auto_healable' THEN 3
    ELSE 4
  END,
  r.created_at DESC;

CREATE VIEW public.ops_auto_healable_reports AS
SELECT r.*, c.title as cert_title
FROM ops_forensic_reports r
LEFT JOIN course_packages cp ON cp.id = r.package_id
LEFT JOIN certifications c ON c.id = cp.curriculum_id
WHERE r.status = 'open' AND r.healability = 'auto_healable' AND r.auto_heal_allowed = true;

CREATE VIEW public.ops_hard_blocked_reports AS
SELECT r.*, c.title as cert_title
FROM ops_forensic_reports r
LEFT JOIN course_packages cp ON cp.id = r.package_id
LEFT JOIN certifications c ON c.id = cp.curriculum_id
WHERE r.status = 'open' AND r.healability = 'hard_blocked';

CREATE VIEW public.ops_exam_pool_promotion_blocked AS
SELECT cp.id as package_id, c.title as cert_title, cp.track, cp.status as package_status,
  ps_promote.status as promote_status, ps_pool.status as exam_pool_status,
  ps_pool.last_error as exam_pool_last_error
FROM course_packages cp
LEFT JOIN certifications c ON c.id = cp.curriculum_id
LEFT JOIN package_steps ps_promote ON ps_promote.package_id = cp.id AND ps_promote.step_key = 'promote_blueprint_variants'
LEFT JOIN package_steps ps_pool ON ps_pool.package_id = cp.id AND ps_pool.step_key = 'generate_exam_pool'
WHERE cp.status = 'building'
  AND ps_pool.status IS NOT NULL AND ps_pool.status NOT IN ('done', 'skipped')
  AND (ps_promote.status IS NULL OR ps_promote.status NOT IN ('done', 'skipped'));
