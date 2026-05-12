DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT * FROM public.admin_reconcile_queued_tail_without_job(false, 10) LOOP
    n := n + 1;
    RAISE NOTICE 'batch4 %: pkg=% step=% gate=% verdict=% action=%', n, r.package_id, r.step_key, r.gate_class, r.reconciler_verdict, r.action;
  END LOOP;
  RAISE NOTICE 'batch4 total: %', n;
END $$;