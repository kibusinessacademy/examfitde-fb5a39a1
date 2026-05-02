CREATE OR REPLACE FUNCTION public.fn_heal_plateau_defer_loop_x14(
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_requeued int := 0;
  v_skipped int := 0;
  v_curriculum uuid;
BEGIN
  FOR v_rec IN
    SELECT 
      ahl.target_id::uuid as package_id,
      MAX( (ahl.metadata->>'open_tail_step') ) as open_step,
      MAX( ((ahl.metadata->'recent_scores')->>0)::int ) as latest_score,
      COUNT(*) as defer_count
    FROM auto_heal_log ahl
    WHERE ahl.action_type = 'tail_step_retryable_deferred'
      AND ahl.created_at > now() - interval '6 hours'
    GROUP BY ahl.target_id
    HAVING COUNT(*) >= 3
  LOOP
    SELECT curriculum_id INTO v_curriculum 
    FROM course_packages WHERE id = v_rec.package_id AND status = 'building';
    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      UPDATE job_queue 
      SET status = 'cancelled',
          completed_at = now(),
          last_error = 'PATTERN_X14_REPLACED_BY_HEAL'
      WHERE package_id = v_rec.package_id 
        AND job_type IN ('package_auto_publish','package_quality_council','package_run_integrity_check')
        AND status = 'pending';

      INSERT INTO job_queue (job_type, package_id, payload, status, scheduled_at, created_at)
      VALUES (
        'package_run_integrity_check',
        v_rec.package_id,
        jsonb_build_object(
          'package_id', v_rec.package_id,
          'curriculum_id', v_curriculum,
          'step_key', 'run_integrity_check',
          'enqueue_source', 'pattern_x14_heal',
          'plateau_score', v_rec.latest_score,
          'defer_count', v_rec.defer_count
        ),
        'pending', now(), now()
      );

      v_requeued := v_requeued + 1;
    END IF;

    INSERT INTO auto_heal_log (action_type, target_id, target_type, result_status, metadata)
    VALUES (
      'pattern_x14_plateau_heal',
      v_rec.package_id,
      'package',
      CASE WHEN p_dry_run THEN 'dry_run' ELSE 'requeued' END,
      jsonb_build_object(
        'pattern','X14',
        'latest_score', v_rec.latest_score,
        'defer_count', v_rec.defer_count,
        'open_step', v_rec.open_step,
        'requeued_job_type','package_run_integrity_check'
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'pattern','X14',
    'dry_run', p_dry_run,
    'requeued', v_requeued,
    'skipped_not_building', v_skipped,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_heal_plateau_defer_loop_x14(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_heal_plateau_defer_loop_x14(boolean) TO service_role;

DO $exec$
DECLARE v_result jsonb;
BEGIN
  v_result := public.fn_heal_plateau_defer_loop_x14(false);
  RAISE NOTICE 'X14 Heal Result: %', v_result;
END $exec$;

SELECT cron.schedule(
  'pattern-x14-plateau-heal-30min',
  '*/30 * * * *',
  $cron$ SELECT public.fn_heal_plateau_defer_loop_x14(false); $cron$
);