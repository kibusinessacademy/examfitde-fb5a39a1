DO $$
DECLARE
  v_results jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(r)) INTO v_results
  FROM public.admin_route_quality_failures_to_repair(5, false, true) r;
  RAISE NOTICE 'route_results: %', v_results;
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('pool_fill_bloom_gaps_patch_d_verify', 'system', 'ok',
          jsonb_build_object('routed', v_results, 'patch', 'D', 'limit', 5));
END $$;