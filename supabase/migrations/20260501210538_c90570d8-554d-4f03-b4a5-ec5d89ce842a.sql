
DO $$
DECLARE
  v_pkg uuid := 'df0deffc-b6f6-4789-ab79-0ab798624660';
  v_result jsonb;
BEGIN
  v_result := admin_nudge_atomic_trigger(v_pkg, false);
  INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
  VALUES (v_pkg, 'package', 'manual_atomic_nudge_tiefbau', 'success', v_result);
END $$;
