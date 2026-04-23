-- Re-trigger atomic step→job coupling for pending_enqueue steps
DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid,
    '015e3cc4-b9c4-42f1-926d-346f3844030a'::uuid,
    '0b2f0df9-e0c1-448d-ad2d-da98e8f6c355'::uuid,
    '21f0b991-17ef-49a7-96fb-71e076a74e7d'::uuid,
    'd1336c74-952a-4b06-8f4d-2fb826346b77'::uuid,
    '96d0fb31-9951-408d-a83e-b2937f5a6af8'::uuid,
    'bd19860b-7efb-46aa-b35e-708c0dc90b2c'::uuid,
    '52cc076a-13ba-4f73-8202-b3f1164bba0f'::uuid,
    '2ec30a3a-7d6e-42bd-a643-e78f6e4c3709'::uuid
  ];
BEGIN
  -- Bump pending_enqueue → queued; the BEFORE trigger creates a fresh job atomically.
  UPDATE public.package_steps
     SET status = 'queued',
         updated_at = now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('admin_bypass_requeue_at', now())
   WHERE package_id = ANY(v_pkg_ids)
     AND status = 'pending_enqueue';

  -- For 'queued' steps without active job: nudge updated_at so step-job-coupling can re-attempt enqueue
  UPDATE public.package_steps ps
     SET updated_at = now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('admin_bypass_nudge_at', now())
   WHERE ps.package_id = ANY(v_pkg_ids)
     AND ps.status = 'queued'
     AND NOT EXISTS (
       SELECT 1 FROM public.job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_' || ps.step_key
          AND jq.status IN ('pending','queued','processing','running','batch_pending')
     );
END $$;