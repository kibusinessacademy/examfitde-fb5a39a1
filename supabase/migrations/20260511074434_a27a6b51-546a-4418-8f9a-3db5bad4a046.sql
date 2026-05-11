INSERT INTO public.job_type_policies
  (job_type, can_run_when_not_building, exempt_from_auto_cancel, is_repair, worker_pool, zombie_timeout_minutes, notes)
VALUES
  ('package_repair_exam_pool_competency_coverage', true, true, true, 'default', 60,
   'Repair: exam-pool competency coverage. Producer fn_enqueue_competency_fill_for_gap_packages targets coverage_gap_blocking_publish — must be allowed on non-building packages.'),
  ('package_repair_exam_pool_lf_coverage', true, true, true, 'default', 60,
   'Repair: exam-pool learning-field coverage. Same producer pattern as competency_coverage.')
ON CONFLICT (job_type) DO UPDATE SET
  can_run_when_not_building = EXCLUDED.can_run_when_not_building,
  exempt_from_auto_cancel = EXCLUDED.exempt_from_auto_cancel,
  is_repair = EXCLUDED.is_repair,
  worker_pool = EXCLUDED.worker_pool,
  zombie_timeout_minutes = EXCLUDED.zombie_timeout_minutes,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'wave_cron_recovery_followup_policies_added',
  'system', 'success',
  jsonb_build_object(
    'wave', 'cron_recovery_followup',
    'policies_added', jsonb_build_array(
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage'
    ),
    'p0_1_status', 'seo_internal_links payload contract: build-dispatch-payload.ts injects mode=batch default — deployed previous wave',
    'p0_2_status', 'PRE_HEARTBEAT_KILL_TERMINAL quarantine (S5) active — 21 packages auto-quarantined; observe re-growth',
    'p1_status', 'policy rows added (this migration)',
    'p2_status', 'seo_sitemap_refresh producer disabled previous wave; residual jobs draining'
  )
);