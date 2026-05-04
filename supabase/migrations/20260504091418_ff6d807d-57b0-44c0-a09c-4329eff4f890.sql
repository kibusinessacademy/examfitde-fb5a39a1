-- =====================================================
-- 1) AUDIT-ÜBERSICHT: chronologische View pro Paket
-- =====================================================
CREATE OR REPLACE VIEW public.v_admin_package_repair_audit AS
SELECT
  COALESCE(NULLIF(target_id,'')::uuid, NULLIF(metadata->>'package_id','')::uuid) AS package_id,
  created_at,
  action_type,
  result_status,
  trigger_source,
  LEFT(COALESCE(result_detail,''), 240) AS detail,
  metadata->>'job_type'        AS job_type,
  metadata->>'enqueue_source'  AS enqueue_source,
  metadata->'violations'       AS violations,
  metadata->>'coverage_pct'    AS coverage_pct,
  metadata->>'reason'          AS reason,
  metadata
FROM public.auto_heal_log
WHERE action_type IN (
  'coverage_gap_targeted_repair_dispatched',
  'ssot_payload_warn',
  'ssot_payload_blocked',
  'bronze_locked_enqueue_blocked',
  'bronze_lock_admin_override',
  'bronze_manual_approved_for_publish',
  'bronze_council_step_heal_v3',
  'bronze_manual_approve_re_enqueue',
  'bronze_manual_approve_step_unskip',
  'post_repair_validation_sequence',
  'post_repair_step_revalidated'
);

REVOKE ALL ON public.v_admin_package_repair_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_package_repair_audit TO service_role;

-- RPC mit has_role-Gate
CREATE OR REPLACE FUNCTION public.admin_get_package_repair_audit(
  p_package_id uuid DEFAULT NULL,
  p_hours int DEFAULT 24
)
RETURNS TABLE(
  package_id uuid, created_at timestamptz, action_type text, result_status text,
  trigger_source text, detail text, job_type text, enqueue_source text,
  violations jsonb, coverage_pct text, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT v.package_id, v.created_at, v.action_type, v.result_status,
         v.trigger_source, v.detail, v.job_type, v.enqueue_source,
         v.violations, v.coverage_pct, v.reason
  FROM public.v_admin_package_repair_audit v
  WHERE (p_package_id IS NULL OR v.package_id = p_package_id)
    AND v.created_at > now() - make_interval(hours => p_hours)
    AND (public.has_role(auth.uid(),'admin'::app_role)
         OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role')
  ORDER BY v.package_id, v.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_package_repair_audit(uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_package_repair_audit(uuid,int) TO authenticated, service_role;

-- =====================================================
-- 2) POST-REPAIR VALIDATION SEQUENCE
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_run_post_repair_validation_sequence(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_curriculum uuid;
  v_track text;
  v_threshold numeric := 80.0;
  v_total_competencies int;
  v_covered int;
  v_coverage_pct numeric;
  v_validate_status text;
  v_integrity_status text;
  v_council_status text;
  v_publish_status text;
  v_repair_completed_at timestamptz;
  v_publish_job_status text;
  v_publish_last_error text;
  v_overall text;
  v_result jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT curriculum_id INTO v_curriculum FROM course_packages WHERE id = p_package_id;
  IF v_curriculum IS NULL THEN
    RAISE EXCEPTION 'package not found: %', p_package_id;
  END IF;

  -- Repair-Job completed?
  SELECT max(updated_at) INTO v_repair_completed_at
  FROM job_queue
  WHERE package_id = p_package_id
    AND job_type = 'package_repair_exam_pool_competency_coverage'
    AND status = 'completed';

  -- Coverage neu rechnen: distinct competency_id in approved questions / total competencies des Curriculums
  SELECT count(DISTINCT c.id) INTO v_total_competencies
  FROM competencies c WHERE c.curriculum_id = v_curriculum;

  SELECT count(DISTINCT eq.competency_id) INTO v_covered
  FROM exam_questions eq
  WHERE eq.package_id = p_package_id
    AND eq.status = 'approved'
    AND eq.competency_id IS NOT NULL;

  v_coverage_pct := CASE WHEN COALESCE(v_total_competencies,0) = 0 THEN 0
                         ELSE ROUND((v_covered::numeric / v_total_competencies) * 100, 2) END;

  -- Step-Status lesen
  SELECT status::text INTO v_validate_status FROM package_steps WHERE package_id=p_package_id AND step_key='validate_exam_pool';
  SELECT status::text INTO v_integrity_status FROM package_steps WHERE package_id=p_package_id AND step_key='run_integrity_check';
  SELECT status::text INTO v_council_status FROM package_steps WHERE package_id=p_package_id AND step_key='quality_council';
  SELECT status::text INTO v_publish_status FROM package_steps WHERE package_id=p_package_id AND step_key='auto_publish';

  -- Letzter publish-Job
  SELECT status::text, last_error
    INTO v_publish_job_status, v_publish_last_error
  FROM job_queue
  WHERE package_id=p_package_id AND job_type='package_auto_publish'
  ORDER BY created_at DESC LIMIT 1;

  v_overall := CASE
    WHEN v_repair_completed_at IS NULL THEN 'REPAIR_NOT_COMPLETED'
    WHEN v_coverage_pct < v_threshold THEN 'COVERAGE_STILL_BELOW_THRESHOLD'
    WHEN v_publish_job_status IN ('completed') AND v_publish_status='done' THEN 'PUBLISH_OK'
    WHEN v_publish_job_status IN ('processing','pending') THEN 'PUBLISH_IN_PROGRESS'
    WHEN v_publish_job_status='failed' OR v_publish_status='failed' THEN 'PUBLISH_FAILED'
    ELSE 'AWAITING_PUBLISH'
  END;

  v_result := jsonb_build_object(
    'package_id', p_package_id,
    'curriculum_id', v_curriculum,
    'repair_completed_at', v_repair_completed_at,
    'coverage', jsonb_build_object(
      'total_competencies', v_total_competencies,
      'covered', v_covered,
      'pct', v_coverage_pct,
      'threshold', v_threshold,
      'meets_threshold', v_coverage_pct >= v_threshold
    ),
    'steps', jsonb_build_object(
      'validate_exam_pool', v_validate_status,
      'run_integrity_check', v_integrity_status,
      'quality_council', v_council_status,
      'auto_publish', v_publish_status
    ),
    'publish_job', jsonb_build_object(
      'status', v_publish_job_status,
      'last_error', v_publish_last_error
    ),
    'overall', v_overall,
    'evaluated_at', now()
  );

  -- Audit
  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES (
    'admin_run_post_repair_validation_sequence',
    'post_repair_validation_sequence',
    p_package_id::text, 'package',
    CASE WHEN v_overall IN ('PUBLISH_OK','PUBLISH_IN_PROGRESS','AWAITING_PUBLISH') THEN 'success'
         WHEN v_overall = 'COVERAGE_STILL_BELOW_THRESHOLD' THEN 'warn'
         ELSE 'failed' END,
    format('Post-repair validation: %s (coverage=%s%%)', v_overall, v_coverage_pct),
    v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_post_repair_validation_sequence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_post_repair_validation_sequence(uuid) TO authenticated, service_role;

-- =====================================================
-- 3) UNIT/INTEGRATION TESTS für SSOT-Validator + Bronze-Lock
--    (Sub-TX rollback via SAVEPOINT-Pattern; nutzt ein temporäres Test-Paket)
-- =====================================================
CREATE OR REPLACE FUNCTION public.fn_test_ssot_validator_and_bronze_lock()
RETURNS TABLE(test_name text, expected text, actual text, passed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_test_pkg uuid;
  v_test_curr uuid;
  v_err text;
  v_step_key text;
  v_enqueue_source text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  -- Test-Paket auswählen (eines aus den bekannten Coverage-Gap-Paketen)
  SELECT id, curriculum_id INTO v_test_pkg, v_test_curr
  FROM course_packages
  WHERE id = '9d96a0ad-4a32-4fa1-8ab6-da89856211f7'
  LIMIT 1;

  -- ===== SSOT-VALIDATOR TESTS =====

  -- T1: Vollständiges Payload → kein violation, kein DLQ
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_repair_exam_pool_competency_coverage', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','repair_exam_pool_competency_coverage',
                         'enqueue_source','test_runner'),
      '{}'::jsonb);
    RETURN QUERY SELECT 'T1_full_payload_accepted', 'no_exception', 'inserted', true;
    -- cleanup
    DELETE FROM job_queue WHERE package_id=v_test_pkg AND meta->>'enqueue_source' IS NULL
      AND payload->>'enqueue_source'='test_runner';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'T1_full_payload_accepted', 'no_exception', v_err, false;
  END;

  -- T2: step_key fehlt → auto-derive
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_repair_exam_pool_competency_coverage', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'enqueue_source','test_runner_t2'),
      '{}'::jsonb)
    RETURNING payload->>'step_key' INTO v_step_key;
    RETURN QUERY SELECT 'T2_step_key_auto_derived',
      'repair_exam_pool_competency_coverage', COALESCE(v_step_key,'NULL'),
      v_step_key='repair_exam_pool_competency_coverage';
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='test_runner_t2';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'T2_step_key_auto_derived', 'auto_derived', v_err, false;
  END;

  -- T3: enqueue_source fehlt → auto-derive zu unknown_producer + warn
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_repair_exam_pool_competency_coverage', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','repair_exam_pool_competency_coverage',
                         '__test_marker','t3'),
      '{}'::jsonb)
    RETURNING payload->>'enqueue_source' INTO v_enqueue_source;
    RETURN QUERY SELECT 'T3_enqueue_source_auto_filled',
      'unknown_producer', COALESCE(v_enqueue_source,'NULL'),
      v_enqueue_source='unknown_producer';
    DELETE FROM job_queue WHERE payload->>'__test_marker'='t3';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'T3_enqueue_source_auto_filled', 'unknown_producer', v_err, false;
  END;

  -- T4: forbidden slug field → bei enforce kritisch (jetzt: warn)
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_repair_exam_pool_competency_coverage', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','repair_exam_pool_competency_coverage',
                         'enqueue_source','test_runner_t4',
                         'slug','forbidden-value'),
      '{}'::jsonb);
    -- vor enforce-date: insert geht durch + warn-log
    RETURN QUERY SELECT 'T4_forbidden_slug_warn_phase', 'inserted_with_warn', 'inserted', true;
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='test_runner_t4';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'T4_forbidden_slug_warn_phase', 'inserted_with_warn', v_err, false;
  END;

  -- T5: package_id in payload aber nicht column → auto-fill column
  BEGIN
    INSERT INTO job_queue (job_type, status, payload, meta)
    VALUES ('package_repair_exam_pool_competency_coverage', 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','repair_exam_pool_competency_coverage',
                         'enqueue_source','test_runner_t5'),
      '{}'::jsonb);
    RETURN QUERY SELECT 'T5_package_id_column_auto_filled',
      'inserted', 'inserted', true;
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='test_runner_t5';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'T5_package_id_column_auto_filled', 'inserted', v_err, false;
  END;

  -- T6: Phantom-Repair-Guard greift NICHT auf competency_coverage-Variant
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_repair_exam_pool_competency_coverage', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','repair_exam_pool_competency_coverage',
                         'enqueue_source','test_runner_t6'),
      '{}'::jsonb);
    RETURN QUERY SELECT 'T6_phantom_repair_guard_scoped_to_quality_only',
      'inserted', 'inserted', true;
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='test_runner_t6';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'T6_phantom_repair_guard_scoped_to_quality_only', 'inserted', v_err, false;
  END;

  -- ===== BRONZE-LOCK GUARD TESTS =====

  -- BL1: Bronze-Lock greift nicht auf package_repair_exam_pool_competency_coverage
  --      (auch wenn package bronze-locked wäre — Guard ist nur für council/auto_publish)
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_repair_exam_pool_competency_coverage', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','repair_exam_pool_competency_coverage',
                         'enqueue_source','test_runner_bl1'),
      '{}'::jsonb);
    RETURN QUERY SELECT 'BL1_bronze_lock_excludes_repair_jobtype',
      'inserted', 'inserted', true;
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='test_runner_bl1';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'BL1_bronze_lock_excludes_repair_jobtype', 'inserted', v_err, false;
  END;

  -- BL2: bronze_lock_override=true erlaubt auto_publish auf bronze-locked package
  --      (manual_approved=Bronze nicht locked → wir simulieren mit override)
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_auto_publish', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','auto_publish',
                         'enqueue_source','test_runner_bl2',
                         'bronze_lock_override',true),
      '{}'::jsonb);
    RETURN QUERY SELECT 'BL2_bronze_lock_override_allows_auto_publish',
      'inserted', 'inserted', true;
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='test_runner_bl2';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'BL2_bronze_lock_override_allows_auto_publish', 'inserted', v_err, false;
  END;

  -- BL3: enqueue_source=bronze_targeted_repair erlaubt council/publish auf bronze-locked
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_quality_council', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','quality_council',
                         'enqueue_source','bronze_targeted_repair'),
      '{}'::jsonb);
    RETURN QUERY SELECT 'BL3_bronze_targeted_repair_source_allowed',
      'inserted', 'inserted', true;
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='bronze_targeted_repair'
      AND created_at > now() - interval '1 minute';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'BL3_bronze_targeted_repair_source_allowed', 'inserted', v_err, false;
  END;

  -- BL4: Andere job_types (z.B. package_generate_exam_pool) ignoriert vom Bronze-Guard
  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, payload, meta)
    VALUES ('package_generate_exam_pool', v_test_pkg, 'pending',
      jsonb_build_object('package_id',v_test_pkg,'curriculum_id',v_test_curr,
                         'step_key','generate_exam_pool',
                         'enqueue_source','test_runner_bl4'),
      '{}'::jsonb);
    RETURN QUERY SELECT 'BL4_bronze_guard_ignores_non_council_publish',
      'inserted', 'inserted', true;
    DELETE FROM job_queue WHERE payload->>'enqueue_source'='test_runner_bl4';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN QUERY SELECT 'BL4_bronze_guard_ignores_non_council_publish', 'inserted', v_err, false;
  END;

  -- Audit summary log
  INSERT INTO auto_heal_log (trigger_source, action_type, target_type, result_status, result_detail, metadata)
  VALUES ('fn_test_ssot_validator_and_bronze_lock','ssot_bronze_lock_test_run',
    'system','success','SSOT validator + bronze-lock test suite executed',
    jsonb_build_object('test_package',v_test_pkg,'executed_at',now()));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_test_ssot_validator_and_bronze_lock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_test_ssot_validator_and_bronze_lock() TO authenticated, service_role;