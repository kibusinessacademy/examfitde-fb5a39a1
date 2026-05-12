DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.fn_recheck_coverage_and_dispatch_auto_publish('32752e03-90d3-49a1-b885-8de86f289020'::uuid) INTO v_result;
  RAISE NOTICE 'recheck_dispatch_result=%', v_result;
END $$;