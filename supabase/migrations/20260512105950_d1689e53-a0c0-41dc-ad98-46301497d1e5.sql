DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.admin_reconcile_queued_tail_without_job(false, 10) LOOP
    RAISE NOTICE 'reconciled: %', row_to_json(r);
  END LOOP;
END $$;