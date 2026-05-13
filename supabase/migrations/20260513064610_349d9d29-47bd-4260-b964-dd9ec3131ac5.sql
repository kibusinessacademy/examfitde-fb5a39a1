DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT * FROM public.v_queued_tail_without_job LIMIT 200 LOOP
    INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('queued_tail_drift_peek_2026_05_13','package',(to_jsonb(r)->>'package_id')::uuid,'observed',to_jsonb(r));
    n := n+1;
  END LOOP;
  RAISE NOTICE 'rows=%',n;
END$$;