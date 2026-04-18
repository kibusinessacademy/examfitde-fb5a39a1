-- 1) Friseur: korrekte ok=true Cleanse (validate_exam_pool ist done, Paket published)
UPDATE package_steps
SET meta = COALESCE(meta,'{}'::jsonb)
  - 'reason_codes' - 'reclassified_by' - 'reset_at' - 'reset_reason'
  || jsonb_build_object(
       'ok', true,
       'executed', true,
       'guard_state','ok',
       'consecutive_no_progress',0,
       'last_guard_action','admin_meta_cleanse_published',
       'meta_cleansed_at', now()::text,
       'cleanse_reason','published_with_stale_HARD_FAIL_REPAIR_EXHAUSTED'
     ),
  updated_at = now()
WHERE package_id = '38f58d97-20a2-49b5-8ba4-737a7887d521'
  AND step_key = 'validate_exam_pool';

INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
VALUES ('admin_meta_cleanse_friseur_stale_exhausted','validate_exam_pool',
  jsonb_build_object('package_id','38f58d97-20a2-49b5-8ba4-737a7887d521',
    'reason','published_with_stale_HARD_FAIL_REPAIR_EXHAUSTED'),
  ARRAY['38f58d97-20a2-49b5-8ba4-737a7887d521'], now());

-- 2) Erweiterte meta-aware Auto-Heal-Funktion
CREATE OR REPLACE FUNCTION public.fn_auto_heal_hard_fail_repair_exhausted()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_healed int := 0; v_skipped int := 0;
  v_step record; v_q_count int; v_curriculum_id uuid;
BEGIN
  FOR v_step IN
    SELECT ps.id, ps.package_id, ps.step_key, ps.status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.step_key = 'validate_exam_pool'
      AND cp.is_published = false
      AND ps.status NOT IN ('done','skipped')
      AND (
        ps.last_error ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
        OR ps.meta->'reason_codes' ? 'HARD_FAIL_REPAIR_EXHAUSTED'
        OR ps.meta->>'guard_state' = 'hard_stalled'
        OR (ps.meta->>'consecutive_no_progress')::int >= 10
      )
  LOOP
    SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = v_step.package_id;

    SELECT COUNT(*) INTO v_q_count
    FROM exam_questions eq
    JOIN curricula c ON c.certification_id = eq.certification_id
    JOIN course_packages cp2 ON cp2.curriculum_id = c.id
    WHERE cp2.id = v_step.package_id AND eq.qc_status IN ('approved','tier1_passed');

    UPDATE package_steps
    SET status = 'queued',
        last_error = format('AUTO_HEALED:meta_aware_reset_q=%s', v_q_count),
        meta = COALESCE(meta,'{}'::jsonb) - 'reason_codes'
          || jsonb_build_object('guard_state','recovering','consecutive_no_progress',0,
               'stall_reason_code','AUTO_HEALED_META_RESET',
               'auto_healed_at', now()::text,
               'auto_healed_q_count', v_q_count),
        updated_at = now()
    WHERE id = v_step.id;

    UPDATE job_queue SET status='cancelled', completed_at=now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancel_reason','auto_healed_meta_reset')
    WHERE package_id = v_step.package_id
      AND job_type = 'package_validate_exam_pool'
      AND status IN ('pending','queued','processing');

    INSERT INTO job_queue (package_id, job_type, status, priority, payload, created_at, lane)
    VALUES (v_step.package_id,'package_validate_exam_pool','pending',5,
      jsonb_build_object('source','auto_heal_meta_aware','q_count',v_q_count,
        'curriculum_id',v_curriculum_id,'is_repair',true),
      now(),'recovery');

    v_healed := v_healed + 1;

    INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
    VALUES ('auto_heal_repair_exhausted_meta_aware','validate_exam_pool',
      jsonb_build_object('package_id',v_step.package_id,'q_count',v_q_count,'trigger','meta_aware_v2'),
      ARRAY[v_step.package_id::text], now());
  END LOOP;

  RETURN jsonb_build_object('healed',v_healed,'skipped',v_skipped,
    'type','hard_fail_repair_exhausted_v2_meta_aware');
END;
$function$;

-- 3) Sofort ausführen
SELECT public.fn_auto_heal_hard_fail_repair_exhausted() AS heal_result;