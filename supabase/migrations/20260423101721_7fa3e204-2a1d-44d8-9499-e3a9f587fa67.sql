DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    '015e3cc4-b9c4-42f1-926d-346f3844030a'::uuid,
    '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709'::uuid
  ];
BEGIN
  -- Force a status round-trip queued→pending_enqueue→queued to retrigger coupling trigger
  UPDATE public.package_steps
     SET status = 'pending_enqueue',
         updated_at = now()
   WHERE package_id = ANY(v_pkg_ids)
     AND status = 'queued';

  UPDATE public.package_steps
     SET status = 'queued',
         updated_at = now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('admin_force_requeue_at', now())
   WHERE package_id = ANY(v_pkg_ids)
     AND status = 'pending_enqueue';
END $$;