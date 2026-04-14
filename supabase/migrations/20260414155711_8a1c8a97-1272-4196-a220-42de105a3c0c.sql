
-- ═══════════════════════════════════════════════════════════
-- Nightly Completion-Sync Audit System
-- ═══════════════════════════════════════════════════════════

-- Results table
CREATE TABLE IF NOT EXISTS public.ops_nightly_audit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_at timestamptz NOT NULL DEFAULT now(),
  layer text NOT NULL,
  finding_key text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  details jsonb NOT NULL DEFAULT '{}',
  auto_healed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_nightly_audit_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_audit_results" ON public.ops_nightly_audit_results
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service_role_all_audit_results" ON public.ops_nightly_audit_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_audit_results_run ON public.ops_nightly_audit_results (audit_run_at DESC);
CREATE INDEX idx_audit_results_severity ON public.ops_nightly_audit_results (severity) WHERE severity IN ('critical', 'warning');

-- ═══════════════════════════════════════════════════════════
-- Main audit function
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_nightly_completion_sync_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_at timestamptz := now();
  v_findings int := 0;
  v_critical int := 0;
  v_warnings int := 0;
  v_healed int := 0;
  v_rec record;
  v_count int;
BEGIN
  -- ═══ LAYER 1: SYNC DRIFT — completed jobs with non-done steps ═══
  FOR v_rec IN
    SELECT jq.package_id, jq.job_type, jq.id as job_id, jq.completed_at,
           ps.step_key, ps.status as step_status
    FROM job_queue jq
    JOIN step_job_mapping sjm ON jq.job_type = ANY(sjm.job_types)
    JOIN package_steps ps ON ps.package_id = jq.package_id AND ps.step_key = sjm.step_key
    WHERE jq.status = 'completed' AND (jq.result->>'ok')::boolean = true
      AND ps.status NOT IN ('done', 'skipped')
      AND jq.completed_at > now() - interval '24 hours'
    LIMIT 50
  LOOP
    INSERT INTO ops_nightly_audit_results (audit_run_at, layer, finding_key, severity, details)
    VALUES (v_run_at, 'sync_drift', 'completed_job_step_not_done', 'critical',
      jsonb_build_object(
        'package_id', v_rec.package_id, 'job_type', v_rec.job_type,
        'job_id', v_rec.job_id, 'step_key', v_rec.step_key,
        'step_status', v_rec.step_status, 'completed_at', v_rec.completed_at
      ));
    v_findings := v_findings + 1;
    v_critical := v_critical + 1;
  END LOOP;

  -- ═══ LAYER 2: HEALER COVERAGE — running steps with completed jobs ═══
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.status as step_status,
           jq.id as job_id, jq.job_type, jq.completed_at
    FROM package_steps ps
    JOIN job_queue jq ON jq.package_id = ps.package_id
      AND jq.status = 'completed' AND (jq.result->>'ok')::boolean = true
      AND jq.job_type = 'package_' || ps.step_key
    WHERE ps.status = 'running'
      AND jq.completed_at > now() - interval '24 hours'
    LIMIT 20
  LOOP
    INSERT INTO ops_nightly_audit_results (audit_run_at, layer, finding_key, severity, details)
    VALUES (v_run_at, 'healer_gap', 'running_step_with_completed_job', 'warning',
      jsonb_build_object(
        'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
        'job_id', v_rec.job_id, 'completed_at', v_rec.completed_at
      ));
    v_findings := v_findings + 1;
    v_warnings := v_warnings + 1;
  END LOOP;

  -- ═══ LAYER 3: GHOST GUARD EVENTS — recent blocks ═══
  SELECT COUNT(*) INTO v_count
  FROM ops_guardrail_events
  WHERE guard_key = 'ghost_completion'
    AND created_at > now() - interval '24 hours';
  
  IF v_count > 0 THEN
    INSERT INTO ops_nightly_audit_results (audit_run_at, layer, finding_key, severity, details)
    VALUES (v_run_at, 'guard_health', 'ghost_completion_blocks', 
      CASE WHEN v_count > 10 THEN 'critical' ELSE 'warning' END,
      jsonb_build_object('count_24h', v_count));
    v_findings := v_findings + 1;
    IF v_count > 10 THEN v_critical := v_critical + 1; ELSE v_warnings := v_warnings + 1; END IF;
  END IF;

  -- ═══ LAYER 4: STEP-MAP PARITY — trigger map vs step_job_mapping SSOT ═══
  SELECT COUNT(*) INTO v_count
  FROM step_job_mapping sjm
  WHERE sjm.step_key NOT IN (
    'repair_exam_pool_quality'
  )
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq 
    WHERE jq.job_type = sjm.job_types[1] 
    LIMIT 0
  )
  AND sjm.step_key NOT IN (
    'build_ai_tutor_index','generate_oral_exam','generate_handbook',
    'generate_exam_pool','generate_glossary','generate_lesson_minichecks',
    'elite_harden','validate_learning_content','quality_council',
    'auto_seed_exam_blueprints','validate_oral_exam','validate_handbook',
    'validate_handbook_depth','validate_tutor_index','validate_lesson_minichecks',
    'validate_blueprints','validate_blueprint_variants','generate_blueprint_variants',
    'promote_blueprint_variants','expand_handbook','enqueue_handbook_expand',
    'finalize_learning_content','auto_publish','run_integrity_check',
    'validate_exam_pool','generate_learning_content','scaffold_learning_course',
    'fanout_learning_content'
  );
  
  IF v_count > 0 THEN
    INSERT INTO ops_nightly_audit_results (audit_run_at, layer, finding_key, severity, details)
    VALUES (v_run_at, 'step_map_parity', 'ssot_steps_missing_from_trigger', 'critical',
      jsonb_build_object('missing_count', v_count));
    v_findings := v_findings + 1;
    v_critical := v_critical + 1;
  END IF;

  -- ═══ LAYER 5: DUAL-TRIGGER HEALTH — steps with job_id pointing to completed jobs ═══
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.status as step_status,
           ps.job_id, ps.meta->>'ok' as meta_ok,
           jq.status as job_status
    FROM package_steps ps
    JOIN job_queue jq ON jq.id = ps.job_id
    WHERE jq.status = 'completed' AND ps.status NOT IN ('done', 'skipped')
    LIMIT 20
  LOOP
    INSERT INTO ops_nightly_audit_results (audit_run_at, layer, finding_key, severity, details)
    VALUES (v_run_at, 'dual_trigger', 'stale_job_id_link', 'critical',
      jsonb_build_object(
        'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
        'step_status', v_rec.step_status, 'job_id', v_rec.job_id,
        'meta_ok', v_rec.meta_ok
      ));
    v_findings := v_findings + 1;
    v_critical := v_critical + 1;
  END LOOP;

  -- ═══ LAYER 6: THROUGHPUT — zero completions in last 6 hours (active building) ═══
  IF EXISTS (SELECT 1 FROM course_packages WHERE status = 'building' LIMIT 1) THEN
    SELECT COUNT(*) INTO v_count
    FROM job_queue WHERE status = 'completed' AND completed_at > now() - interval '6 hours';
    
    IF v_count = 0 THEN
      INSERT INTO ops_nightly_audit_results (audit_run_at, layer, finding_key, severity, details)
      VALUES (v_run_at, 'throughput', 'zero_completions_6h', 'critical',
        jsonb_build_object('building_packages', (SELECT COUNT(*) FROM course_packages WHERE status = 'building')));
      v_findings := v_findings + 1;
      v_critical := v_critical + 1;
    END IF;
  END IF;

  -- ═══ Create admin notification if critical findings ═══
  IF v_critical > 0 THEN
    INSERT INTO admin_notifications (title, body, category, severity, metadata)
    VALUES (
      'Nightly Audit: ' || v_critical || ' kritische Findings',
      'Das nächtliche Completion-Sync Audit hat ' || v_findings || ' Findings gefunden (' || v_critical || ' kritisch, ' || v_warnings || ' Warnungen).',
      'pipeline',
      'critical',
      jsonb_build_object('audit_run_at', v_run_at, 'findings', v_findings, 'critical', v_critical, 'warnings', v_warnings, 'healed', v_healed)
    );
  END IF;

  -- Cleanup old results (keep 30 days)
  DELETE FROM ops_nightly_audit_results WHERE audit_run_at < now() - interval '30 days';

  RETURN jsonb_build_object(
    'ok', v_critical = 0,
    'audit_run_at', v_run_at,
    'findings', v_findings,
    'critical', v_critical,
    'warnings', v_warnings,
    'healed', v_healed
  );
END;
$function$;
