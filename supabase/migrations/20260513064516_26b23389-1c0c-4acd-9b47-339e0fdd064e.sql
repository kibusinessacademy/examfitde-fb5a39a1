DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.admin_reconcile_queued_tail_without_job(true, 50) LOOP
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('reconcile_queued_tail_dry_run_smoke_2026_05_13', 'package', r.package_id, COALESCE(r.action_taken,'unknown'), to_jsonb(r));
  END LOOP;
END$$;