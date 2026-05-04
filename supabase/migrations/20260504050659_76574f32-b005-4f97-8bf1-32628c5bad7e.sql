DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.admin_heal_pending_enqueue_drift(
    ARRAY[
      'a02cde5e-a0ad-45fc-a5db-ffe239d387f5',
      '586c6a12-3042-46d2-8981-5d7645b2cbf6',
      '4866a5b0-1430-4ab3-825b-141605d99612',
      '55edacdf-5230-4e9a-b9c1-dcde00b8cd47',
      '41b8c6db-059b-44ff-986b-5d2e7f212a0c'
    ]::uuid[],
    'forensic_control_lane_unstick_v1',
    false
  );

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'forensic_control_lane_heal',
    'system',
    'success',
    'admin_heal_pending_enqueue_drift executed for 5 control-lane stuck packages',
    v_result
  );

  RAISE NOTICE 'Heal result: %', v_result;
END $$;