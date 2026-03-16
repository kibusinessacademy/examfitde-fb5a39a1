
-- 1. Harden fix_zombie_packages with recovery grace
CREATE OR REPLACE FUNCTION public.fix_zombie_packages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fixed_ids uuid[];
  fixed_count int;
BEGIN
  WITH zombies AS (
    SELECT cp.id
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM package_leases pl
        WHERE pl.package_id = cp.id AND pl.lease_until > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE (jq.payload->>'package_id')::uuid = cp.id
          AND jq.status IN ('pending', 'processing')
      )
      AND cp.updated_at < now() - interval '10 minutes'
      -- Recovery grace: skip recently recovered packages
      AND NOT EXISTS (
        SELECT 1 FROM auto_heal_log ah
        WHERE ah.target_id = cp.id::text
          AND ah.action_type = 'recover_and_reenter_package'
          AND ah.result_status = 'success'
          AND ah.created_at > now() - interval '15 minutes'
      )
  )
  UPDATE course_packages cp
  SET status = 'queued', last_error = NULL
  FROM zombies z
  WHERE cp.id = z.id
  RETURNING cp.id INTO fixed_ids;

  GET DIAGNOSTICS fixed_count = ROW_COUNT;

  IF fixed_count > 0 THEN
    INSERT INTO admin_notifications (title, body, category, severity, metadata)
    VALUES (
      'Zombie-Packages automatisch bereinigt',
      fixed_count || ' Pakete von building→queued zurückgesetzt (keine Lease, keine Jobs)',
      'pipeline', 'warning',
      jsonb_build_object('fixed_count', fixed_count, 'fixed_ids', to_jsonb(fixed_ids))
    );
  END IF;

  RETURN jsonb_build_object('fixed_count', fixed_count, 'fixed_ids', COALESCE(to_jsonb(fixed_ids), '[]'::jsonb));
END;
$$;

-- 2. Re-enter the 10 packages (Wave 1, Attempt 5)
DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '188daeb5-205e-4fb4-aadc-de59029406f5','398573ab-bc9d-4fc9-9d8e-3607c24f3bf9',
    '575a917a-bd7c-48df-afc0-bda29389c40f','5d23ff92-0f91-4f19-a01b-3b7f8edc38ff',
    '6337d885-bd02-4d4f-aaa5-fb118d643cd8','92d333cf-bbd3-4292-b85b-ba933c7c4ae1',
    'ae384df2-2ce2-4842-8074-3c9f0ebbb414','c636b6bc-fcae-4d8f-b8ca-87647d9fee6c',
    'e90a5e24-5a51-4afa-aeae-0b97407eadee','ebbc4dcb-ff3a-43fb-b9d1-dad8d1e22de3'
  ];
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM public.recover_and_reenter_package(
      v_id, 'wave1-attempt5: production-watchdog + fix_zombie_packages patched', 'ops_panel', NULL
    );
  END LOOP;
END;
$$;
