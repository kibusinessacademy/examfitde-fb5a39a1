DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.admin_route_quality_failures_to_repair(3, false, true) LOOP
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('manual_route_quality_failures_limit3', 'package', 'success',
      jsonb_build_object('row', to_jsonb(r)));
  END LOOP;
END $$;