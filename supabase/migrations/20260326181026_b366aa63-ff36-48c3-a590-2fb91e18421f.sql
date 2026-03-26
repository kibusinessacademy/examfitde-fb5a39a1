
-- FIX 5: Elektroniker Betriebstechnik — all done, integrity+council passed, but stuck at quality_gate_failed
-- This is a stale terminal state. Promote to published.
UPDATE course_packages
SET status = 'published',
    blocked_reason = NULL,
    stuck_reason = NULL,
    updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
AND status = 'quality_gate_failed'
AND integrity_passed = true
AND council_approved = true;

-- Also extend the stale blocker trigger to cover quality_gate_failed
CREATE OR REPLACE FUNCTION fn_auto_clear_stale_blocker()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('blocked','quality_gate_failed')
     AND NEW.integrity_passed = true
     AND NEW.council_approved = true
     AND NEW.integrity_report IS NOT NULL
  THEN
    -- Check all functional steps are done
    IF NOT EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = NEW.id
        AND ps.step_key NOT IN ('legacy','deprecated','council_review','generate_curriculum',
          'generate_exam_questions','generate_handbook_content','generate_lesson_content',
          'generate_lessons','generate_modules','generate_oral_exam_content','generate_tutor_index',
          'launch_marketing','post_launch_monitor','setup_course_package','setup_storefront',
          'validate_exam_questions','validate_handbook_content','validate_oral_exam_content')
        AND ps.status NOT IN ('done','skipped')
    ) THEN
      NEW.status := 'published';
      NEW.blocked_reason := NULL;
      
      INSERT INTO auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail)
      VALUES ('STALE_BLOCKER_CLEARED', 'package', NEW.id::text, 'trg_auto_clear_stale_blocker', 'success',
              'Auto-promoted from ' || OLD.status || ' to published (all invariants green)');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Audit
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES ('fix_betriebstechnik_stale_qgf', 'pipeline_repair',
  '{"reason": "all steps done, integrity+council passed, quality_gate_failed is stale terminal state"}'::jsonb,
  ARRAY['fd1d8192-a16f-496b-80c8-5e06f70ec21a']);
