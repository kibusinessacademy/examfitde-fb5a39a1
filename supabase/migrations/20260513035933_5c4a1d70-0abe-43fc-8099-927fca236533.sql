-- Patch D verify: route exactly 1 quality failure to repair (cancel integrity loop=true)
DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(r) INTO v_result
  FROM public.admin_route_quality_failures_to_repair(1, false, true) r
  LIMIT 1;
  RAISE NOTICE 'route_result: %', v_result;
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('pool_fill_bloom_gaps_patch_d_verify', 'system', 'ok',
          jsonb_build_object('routed', v_result, 'patch', 'D', 'limit', 1));
END $$;