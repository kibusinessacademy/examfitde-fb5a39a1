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
  v_pkg uuid;
  v_terminated_count int;
BEGIN
  FOREACH v_pkg IN ARRAY v_pkg_ids LOOP
    -- 1) Cancel blocked jobs
    UPDATE public.job_queue
       SET status = 'cancelled',
           last_error = COALESCE(last_error,'') || ' [admin_bypass_heal '||now()::text||']',
           updated_at = now(),
           completed_at = now()
     WHERE package_id = v_pkg
       AND status IN ('failed','pending','queued','processing','running','batch_pending')
       AND (
         last_error ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
         OR last_error ILIKE '%REPAIR_COMPETENCY_COVERAGE%'
         OR last_error ILIKE '%STALE_LOCK_LOOP%'
         OR last_error ILIKE '%REQUEUE_LOOP%'
         OR last_error ILIKE '%TOO_FEW_APPROVED%'
         OR last_error ILIKE '%LF_COVERAGE%'
       );
    GET DIAGNOSTICS v_terminated_count = ROW_COUNT;

    -- 2) Reset exhaustion meta ONLY on non-done steps (avoid regression guard)
    UPDATE public.package_steps
       SET meta = COALESCE(meta,'{}'::jsonb)
                  - 'exhausted'
                  - 'repair_exhausted'
                  - 'hard_fail_count'
                  - 'consecutive_failures'
                  || jsonb_build_object('admin_bypass_reset_at', now(), 'admin_bypass_reason', 'manual heal 9 stalled packages'),
           updated_at = now()
     WHERE package_id = v_pkg
       AND status <> 'done';

    -- 3) Manual heal with zero cooldown
    BEGIN
      PERFORM public.admin_manual_heal_package(
        v_pkg,
        NULL::text,
        true,
        'manual_bypass_heal_admin_request_2026-04-23',
        0
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'manual_heal failed for %: %', v_pkg, SQLERRM;
    END;

    RAISE NOTICE 'Pkg % bypassed (% jobs cancelled)', v_pkg, v_terminated_count;
  END LOOP;
END $$;