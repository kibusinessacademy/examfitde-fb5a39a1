-- One-shot heal: nudge tail-steps for building packages with no active jobs (Cluster Heal 2026-05-06)
-- Audited via auto_heal_log (action_type='cluster_heal_nudge_2026_05_06').
DO $$
DECLARE
  r record;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_result jsonb;
  v_run_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('cluster_heal_nudge_2026_05_06', 'system', NULL, 'started',
          jsonb_build_object('run_id', v_run_id, 'reason', 'producer_blocked_progress_top_cluster_24h'));

  FOR r IN
    SELECT cp.id AS pkg, cp.title, cp.track
    FROM public.course_packages cp
    WHERE cp.status = 'building'
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.status = 'queued'
          AND ps.step_key IN ('quality_council','run_integrity_check','auto_publish','validate_tutor_index','validate_exam_pool','generate_exam_pool')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.package_id = cp.id AND jq.status IN ('queued','processing')
      )
  LOOP
    BEGIN
      v_result := public.admin_nudge_atomic_trigger(r.pkg, false);
      v_dispatched := v_dispatched + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('cluster_heal_nudge_2026_05_06', 'package', r.pkg::text, 'dispatched',
              jsonb_build_object('run_id', v_run_id, 'title', r.title, 'track', r.track, 'nudge_result', v_result));
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('cluster_heal_nudge_2026_05_06', 'package', r.pkg::text, 'skipped',
              jsonb_build_object('run_id', v_run_id, 'title', r.title, 'track', r.track, 'error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('cluster_heal_nudge_2026_05_06', 'system', NULL, 'completed',
          jsonb_build_object('run_id', v_run_id, 'dispatched', v_dispatched, 'skipped', v_skipped));
END $$;