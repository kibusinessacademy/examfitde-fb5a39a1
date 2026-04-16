
CREATE OR REPLACE FUNCTION public.admin_force_steps_done(
  p_package_id uuid,
  p_step_keys text[],
  p_reason text DEFAULT 'admin_force',
  p_emergency_bypass boolean DEFAULT false,
  p_force_publish boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
  v_bypassed_ps_triggers text[];
  v_bypassed_cp_triggers text[];
  v_all_bypassed text[];
BEGIN
  -- === PHASE 1: Disable package_steps guards (always) ===
  v_bypassed_ps_triggers := ARRAY[
    'trg_guard_step_causality','trg_guard_governance_step_finalization',
    'trg_guard_quality_council_requires_execution','trg_guard_integrity_requires_execution',
    'trg_guard_auto_publish_done','trg_guard_auto_publish_preconditions',
    'trg_guard_ghost_completion','trg_guard_ghost_step_finalization',
    'trg_guard_hollow_done','trg_guard_oral_exam_completeness',
    'trg_guard_step_done_regression','trg_guard_step_done_thresholds',
    'trg_guard_package_step_meta_contract','trg_guard_council_step_reset',
    'trg_guard_exception_approved','trg_guard_step_failed_requires_reason',
    'trg_guard_step_key_ssot','trg_guard_canonical_step_keys',
    'trg_guard_validate_exam_pool_gate','trg_guard_step_requeue_attempts'
  ];

  -- Disable all package_steps guards (safe: IF EXISTS pattern via DO block not needed, 
  -- we handle missing triggers gracefully)
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_causality; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_governance_step_finalization; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_quality_council_requires_execution; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_integrity_requires_execution; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_auto_publish_done; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_auto_publish_preconditions; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_ghost_completion; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_ghost_step_finalization; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_hollow_done; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_oral_exam_completeness; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_done_regression; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_done_thresholds; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_package_step_meta_contract; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_council_step_reset; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_exception_approved; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_failed_requires_reason; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_key_ssot; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_canonical_step_keys; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_validate_exam_pool_gate; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_requeue_attempts; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps DISABLE TRIGGER trg_block_publish_on_stale_integrity; EXCEPTION WHEN undefined_object THEN NULL; END;

  -- === PHASE 2: Emergency bypass — also disable course_packages guards ===
  v_bypassed_cp_triggers := ARRAY[]::text[];
  
  IF p_emergency_bypass THEN
    v_bypassed_cp_triggers := ARRAY[
      'guard_publish_requires_questions','guard_publish_requires_real_content',
      'trg_guard_blocked_requires_reason','trg_guard_build_progress_drift',
      'trg_guard_building_published_drift','trg_guard_building_requires_enrichment',
      'trg_guard_building_to_queued_with_jobs','trg_guard_council_approved',
      'trg_guard_council_approved_drift','trg_guard_council_consistency',
      'trg_guard_council_review_status','trg_guard_integrity_passed_drift',
      'trg_guard_integrity_report_consistency','trg_guard_no_exam_first',
      'trg_guard_package_curriculum_id','trg_guard_package_publish_requires_didaktik',
      'trg_guard_publish_requires_questions','trg_guard_publish_requires_real_content',
      'trg_guard_publish_step_drift','trg_guard_published_immutable'
    ];

    BEGIN ALTER TABLE course_packages DISABLE TRIGGER guard_publish_requires_questions; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER guard_publish_requires_real_content; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_blocked_requires_reason; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_build_progress_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_requires_enrichment; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_to_queued_with_jobs; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_consistency; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_review_status; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_passed_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_report_consistency; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_no_exam_first; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_package_curriculum_id; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_package_publish_requires_didaktik; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_questions; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_real_content; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_step_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
    BEGIN ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable; EXCEPTION WHEN undefined_object THEN NULL; END;
  END IF;

  v_all_bypassed := v_bypassed_ps_triggers || v_bypassed_cp_triggers;

  -- === PHASE 3: Force steps done ===
  UPDATE package_steps
  SET status = 'done',
      started_at = COALESCE(started_at, now()),
      finished_at = now(),
      updated_at = now(),
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'ok', true,
        'done_reason', p_reason,
        'force_done_at', now()::text,
        'emergency_bypass', p_emergency_bypass,
        'bypassed_triggers', to_jsonb(v_all_bypassed),
        'affected_tables', CASE WHEN p_emergency_bypass 
          THEN '["package_steps","course_packages"]'::jsonb 
          ELSE '["package_steps"]'::jsonb END
      )
  WHERE package_id = p_package_id
    AND step_key = ANY(p_step_keys)
    AND status NOT IN ('done','skipped');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- === PHASE 4: Optional force-publish ===
  IF p_emergency_bypass AND p_force_publish THEN
    UPDATE course_packages
    SET status = 'published',
        build_progress = 100,
        integrity_passed = true,
        council_approved = true,
        blocked_reason = NULL,
        blocked_by = NULL,
        blocked_at = NULL,
        stuck_reason = NULL,
        updated_at = now()
    WHERE id = p_package_id;
  ELSIF p_emergency_bypass THEN
    -- At minimum clear blocking state
    UPDATE course_packages
    SET blocked_reason = NULL,
        blocked_by = NULL,
        blocked_at = NULL,
        stuck_reason = NULL,
        updated_at = now()
    WHERE id = p_package_id;
  END IF;

  -- === PHASE 5: Re-enable ALL triggers (always, even on error) ===
  -- package_steps
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_causality; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_governance_step_finalization; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_quality_council_requires_execution; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_integrity_requires_execution; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_auto_publish_done; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_auto_publish_preconditions; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_ghost_completion; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_ghost_step_finalization; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_hollow_done; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_oral_exam_completeness; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_done_regression; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_done_thresholds; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_package_step_meta_contract; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_council_step_reset; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_exception_approved; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_failed_requires_reason; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_key_ssot; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_canonical_step_keys; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_validate_exam_pool_gate; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_requeue_attempts; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE package_steps ENABLE TRIGGER trg_block_publish_on_stale_integrity; EXCEPTION WHEN undefined_object THEN NULL; END;

  -- course_packages (always re-enable even if not disabled — idempotent)
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER guard_publish_requires_questions; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER guard_publish_requires_real_content; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_blocked_requires_reason; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_build_progress_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_requires_enrichment; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_to_queued_with_jobs; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_consistency; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_review_status; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_report_consistency; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_no_exam_first; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_package_curriculum_id; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_package_publish_requires_didaktik; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_questions; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_real_content; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_step_drift; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable; EXCEPTION WHEN undefined_object THEN NULL; END;

  -- === PHASE 6: Audit ===
  INSERT INTO admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'force_steps_done',
    'package_steps',
    jsonb_build_object(
      'package_id', p_package_id,
      'step_keys', to_jsonb(p_step_keys),
      'reason', p_reason,
      'rows_updated', v_updated,
      'emergency_bypass', p_emergency_bypass,
      'force_publish', p_force_publish,
      'bypassed_trigger_groups', jsonb_build_object(
        'package_steps', to_jsonb(v_bypassed_ps_triggers),
        'course_packages', to_jsonb(v_bypassed_cp_triggers)
      ),
      'affected_tables', CASE WHEN p_emergency_bypass 
        THEN ARRAY['package_steps','course_packages'] 
        ELSE ARRAY['package_steps'] END
    ),
    ARRAY[p_package_id::text]
  );

  RETURN jsonb_build_object(
    'ok', true, 
    'updated', v_updated, 
    'package_id', p_package_id,
    'emergency_bypass', p_emergency_bypass,
    'force_publish', p_force_publish,
    'bypassed_triggers_count', array_length(v_all_bypassed, 1)
  );
END;
$$;
