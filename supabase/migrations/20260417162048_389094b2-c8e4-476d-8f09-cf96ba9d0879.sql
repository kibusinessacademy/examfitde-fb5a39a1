INSERT INTO public.ops_job_type_registry (job_type, pool, description)
VALUES ('package_repair_exam_pool_lf_coverage', 'default',
        'Targeted LF-coverage repair (D+ semantic fix) — generates questions for under-represented learning fields without full pool regeneration')
ON CONFLICT (job_type) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO admin_actions (user_id, action, scope, payload)
VALUES (NULL, 'heal_dplus_phase1_finalized', 'system',
  jsonb_build_object(
    'phase','D+ Phase 1 fully complete',
    'changes', jsonb_build_array(
      'fn_classify_exam_pool_gate: REPAIR_LF_COVERAGE classification added',
      'fn_get_lf_coverage_deficit: helper for targeted repair input',
      'auto-heal loop killed (attempts>=2)',
      '4 packages reclassified (Schifffahrt, Textilreiniger, Bankfachwirt, PRINCE2)',
      'new job_type registered: package_repair_exam_pool_lf_coverage'
    )
  ));