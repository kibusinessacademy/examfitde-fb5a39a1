
-- ============================================================
-- 1. Add gate_class field to course_packages
-- ============================================================
ALTER TABLE public.course_packages 
ADD COLUMN IF NOT EXISTS gate_class text DEFAULT NULL;

COMMENT ON COLUMN public.course_packages.gate_class IS 
  'Gate classification: terminal, recoverable, admin_hold. Controls whether auto-cancel fires.';

-- ============================================================
-- 2. SSOT function: classify gate failure reasons
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_classify_gate_failure(
  p_hard_fail_reasons text[],
  p_progress_percent numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_terminal_patterns text[] := ARRAY[
    'SSOT_VIOLATION', 'CURRICULUM_MISSING', 'INTEGRITY_HARD_FAIL',
    'PUBLISH_POSTCONDITION_FAILED', 'DATA_CORRUPTION', 'ILLEGAL_STATE',
    'IMMUTABLE_PACKAGE', 'STRUCTURAL_FAILURE'
  ];
  v_reason text;
  v_pattern text;
  v_has_terminal boolean := false;
  v_terminal_reasons text[] := '{}';
  v_recoverable_reasons text[] := '{}';
BEGIN
  IF p_hard_fail_reasons IS NULL OR array_length(p_hard_fail_reasons, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'gate_class', 'healthy',
      'allow_package_fail', false,
      'should_cancel_jobs', false,
      'recommended_status', 'building',
      'terminal_reasons', '[]'::jsonb,
      'recoverable_reasons', '[]'::jsonb
    );
  END IF;

  FOREACH v_reason IN ARRAY p_hard_fail_reasons LOOP
    DECLARE
      v_is_terminal boolean := false;
    BEGIN
      FOREACH v_pattern IN ARRAY v_terminal_patterns LOOP
        IF v_reason ILIKE '%' || v_pattern || '%' THEN
          v_is_terminal := true;
          v_has_terminal := true;
          v_terminal_reasons := array_append(v_terminal_reasons, v_reason);
          EXIT;
        END IF;
      END LOOP;
      IF NOT v_is_terminal THEN
        v_recoverable_reasons := array_append(v_recoverable_reasons, v_reason);
      END IF;
    END;
  END LOOP;

  -- Progress-aware guard: >= 70% progress AND no terminal → never fail
  IF NOT v_has_terminal AND p_progress_percent >= 70 THEN
    RETURN jsonb_build_object(
      'gate_class', 'recoverable',
      'allow_package_fail', false,
      'should_cancel_jobs', false,
      'recommended_status', 'building',
      'recovery_mode', 'heal_upstream',
      'terminal_reasons', to_jsonb(v_terminal_reasons),
      'recoverable_reasons', to_jsonb(v_recoverable_reasons)
    );
  END IF;

  IF v_has_terminal THEN
    RETURN jsonb_build_object(
      'gate_class', 'terminal',
      'allow_package_fail', true,
      'should_cancel_jobs', true,
      'recommended_status', 'quality_gate_failed',
      'recovery_mode', 'terminal',
      'terminal_reasons', to_jsonb(v_terminal_reasons),
      'recoverable_reasons', to_jsonb(v_recoverable_reasons)
    );
  END IF;

  -- All recoverable, < 70% progress: still don't fail, just flag
  RETURN jsonb_build_object(
    'gate_class', 'recoverable',
    'allow_package_fail', false,
    'should_cancel_jobs', false,
    'recommended_status', 'building',
    'recovery_mode', 'heal_upstream',
    'terminal_reasons', to_jsonb(v_terminal_reasons),
    'recoverable_reasons', to_jsonb(v_recoverable_reasons)
  );
END;
$$;

-- ============================================================
-- 3. Harden auto-cancel trigger: only cancel on terminal exits
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_auto_cancel_jobs_on_package_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled int := 0;
  v_gate_class text;
BEGIN
  -- Only act when leaving 'building'
  IF OLD.status = 'building' AND NEW.status IS DISTINCT FROM 'building' THEN
    
    -- Check gate_class: if 'recoverable', do NOT cancel jobs
    v_gate_class := COALESCE(NEW.gate_class, 'unknown');
    
    IF NEW.status = 'quality_gate_failed' AND v_gate_class = 'recoverable' THEN
      -- BLOCK the transition: recoverable failures must stay in building
      NEW.status := 'building';
      NEW.gate_class := 'recoverable';
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('qgf_bounce_prevented', NEW.id, 'run_integrity_check',
              jsonb_build_object(
                'blocked_transition', 'building→quality_gate_failed',
                'gate_class', v_gate_class,
                'reason', 'recoverable failures do not allow package termination'
              ));
      RETURN NEW;
    END IF;

    -- Terminal exit or other status change: cancel non-exempt jobs
    WITH cancelled AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL
      FROM job_type_policies jtp
      WHERE jtp.job_type = jq.job_type
        AND jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
      RETURNING jq.id
    )
    SELECT count(*) INTO v_cancelled FROM cancelled;

    -- Also cancel unknown job types
    WITH cancelled_unknown AS (
      UPDATE job_queue jq
      SET status = 'cancelled',
          last_error = format('AUTO_CANCEL: package status changed %s → %s (gate_class=%s)', OLD.status, NEW.status, v_gate_class),
          completed_at = now(),
          updated_at = now(),
          locked_at = NULL,
          locked_by = NULL
      WHERE jq.package_id = NEW.id
        AND jq.status IN ('pending', 'batch_pending')
        AND NOT EXISTS (SELECT 1 FROM job_type_policies p WHERE p.job_type = jq.job_type AND p.exempt_from_auto_cancel)
      RETURNING jq.id
    )
    SELECT v_cancelled + count(*) INTO v_cancelled FROM cancelled_unknown;

    IF v_cancelled > 0 THEN
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('auto_cancel_on_exit', NEW.id, NULL,
              jsonb_build_object(
                'cancelled_count', v_cancelled,
                'old_status', OLD.status,
                'new_status', NEW.status,
                'gate_class', v_gate_class
              ));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Immediate heal: restore 4 stuck packages to building
-- ============================================================
UPDATE course_packages 
SET status = 'building', 
    gate_class = 'recoverable',
    blocked_reason = NULL, 
    updated_at = now()
WHERE id IN (
  '047bc325-5244-4f21-affd-5395bf62bcff',
  '6a2c6859-4b3b-4f6e-b32d-c2574a1333ad',
  'a0b0c0d0-0010-4000-8000-000000000001',
  'c5000000-0004-4000-8000-000000000001'
)
AND status = 'quality_gate_failed';
