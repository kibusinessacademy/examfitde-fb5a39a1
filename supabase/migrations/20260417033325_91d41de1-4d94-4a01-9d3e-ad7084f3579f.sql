-- Finalisierung: 4 publish-ready Pakete mit force_publish=true
DO $$
DECLARE
  pkg_id uuid;
  step_list text[];
BEGIN
  FOR pkg_id IN SELECT unnest(ARRAY[
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid, -- PRINCE2
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid, -- Bankfachwirt
    'd7fd81c3-283e-4270-acef-812b08501442'::uuid, -- Tech. Produktdesigner
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid  -- Finanzanlagenvermittler
  ])
  LOOP
    SELECT array_agg(step_key) INTO step_list
    FROM package_steps
    WHERE package_id = pkg_id AND status NOT IN ('done','skipped');
    
    IF step_list IS NOT NULL AND array_length(step_list, 1) > 0 THEN
      BEGIN
        PERFORM admin_force_steps_done(
          p_package_id := pkg_id,
          p_step_keys := step_list,
          p_reason := 'manual_p1_finalize_with_publish',
          p_emergency_bypass := true,
          p_force_publish := true
        );
        RAISE NOTICE 'Finalize+Publish OK for %: % steps', pkg_id, array_length(step_list, 1);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Finalize FAILED for %: %', pkg_id, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- Reaktiviere is_repair für building-Pakete (Bonus-WIP)
UPDATE course_packages
SET is_repair = true, updated_at = now()
WHERE id IN (
  '3e070545-c555-417a-a047-c7541ebb2a7c',
  '96d0fb31-9951-408d-a83e-b2937f5a6af8',
  '5377ab93-fe17-488c-a266-bdb26b672da7',
  '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
  'dd000001-0005-4000-8000-000000000001',
  'd2000000-0001-4000-8000-000000000001'
)
AND is_repair = false;

-- Audit log
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'manual_p1_finalize_publish_batch',
  'pipeline',
  jsonb_build_object(
    'reason', 'Finalisierung 4x bypass + reactivate is_repair für 6x building',
    'force_published_count', 4
  ),
  ARRAY[
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8',
    'd7fd81c3-283e-4270-acef-812b08501442','ba96f6d9-c638-4bf3-aaca-3465ac363e8b'
  ]::text[]
);