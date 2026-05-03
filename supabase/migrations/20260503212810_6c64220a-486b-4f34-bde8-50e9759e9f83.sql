DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.fn_reschedule_pending_enqueue_steps(60, 50, 'manual_phase_a_prebuild_unblock');
  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'manual_pending_enqueue_heal_phase_a','system',NULL,'success',
    'fn_reschedule_pending_enqueue_steps',
    jsonb_build_object(
      'rescheduled_count', r.rescheduled_count,
      'skipped_active', r.skipped_active,
      'skipped_not_building', r.skipped_not_building
    )
  );
END $$;