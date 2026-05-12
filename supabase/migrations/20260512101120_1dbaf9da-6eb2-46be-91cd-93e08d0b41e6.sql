DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.admin_reconcile_queued_tail_without_job(true, 5) LOOP
    RAISE NOTICE 'DRY: %', to_jsonb(r);
  END LOOP;
END$$;