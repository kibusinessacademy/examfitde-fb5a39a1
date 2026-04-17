-- HEAL-FIRST v3: Taxonomie-konformer blocked_reason

UPDATE course_packages
SET 
  status = 'pipeline_repair_required',
  blocked_reason = 'pipeline_repair_required',
  blocked_at = now(),
  is_repair = true,
  integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
    'repair_attempts_24h', 0,
    'no_effect_repairs_2h', 0,
    'consecutive_no_progress', 0,
    'manual_bypass_at', now(),
    'manual_bypass_reason', 'P1_emergency_heal_batch_v3'
  ),
  updated_at = now()
WHERE id IN (
  'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','3e070545-c555-417a-a047-c7541ebb2a7c',
  '96d0fb31-9951-408d-a83e-b2937f5a6af8','d7fd81c3-283e-4270-acef-812b08501442',
  'd2000000-0001-4000-8000-000000000001','5377ab93-fe17-488c-a266-bdb26b672da7',
  '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
  'ba96f6d9-c638-4bf3-aaca-3465ac363e8b','dd000001-0005-4000-8000-000000000001'
);

DELETE FROM job_queue
WHERE package_id IN (
  'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','3e070545-c555-417a-a047-c7541ebb2a7c',
  '96d0fb31-9951-408d-a83e-b2937f5a6af8','d7fd81c3-283e-4270-acef-812b08501442',
  'd2000000-0001-4000-8000-000000000001','5377ab93-fe17-488c-a266-bdb26b672da7',
  '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
  'ba96f6d9-c638-4bf3-aaca-3465ac363e8b','dd000001-0005-4000-8000-000000000001'
)
AND (
  status = 'failed' 
  OR (last_error ILIKE '%REPAIR_EXHAUSTED%' OR last_error ILIKE '%HARD_FAIL%')
  OR meta->>'guard_state' = 'exhausted'
);

-- 100%-Pakete: Emergency Bypass auf alle offenen Steps
DO $$
DECLARE
  pkg_id uuid;
  step_list text[];
BEGIN
  FOR pkg_id IN SELECT unnest(ARRAY[
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid,
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid,
    'd7fd81c3-283e-4270-acef-812b08501442'::uuid,
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid
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
          p_reason := 'manual_p1_emergency_bypass_heal',
          p_emergency_bypass := true,
          p_force_publish := false
        );
        RAISE NOTICE 'Bypass OK for %: % steps', pkg_id, array_length(step_list, 1);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Bypass FAILED for %: %', pkg_id, SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'Bypass SKIP for %: no open steps', pkg_id;
    END IF;
  END LOOP;
END $$;

-- <100%-Pakete: Hard Rebuild
DO $$
DECLARE
  pkg_id uuid;
BEGIN
  FOR pkg_id IN SELECT unnest(ARRAY[
    '3e070545-c555-417a-a047-c7541ebb2a7c'::uuid,
    '96d0fb31-9951-408d-a83e-b2937f5a6af8'::uuid,
    '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid,
    '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9'::uuid,
    'dd000001-0005-4000-8000-000000000001'::uuid,
    'd2000000-0001-4000-8000-000000000001'::uuid
  ])
  LOOP
    BEGIN
      PERFORM admin_force_depublish_and_rebuild(p_package_id := pkg_id);
      RAISE NOTICE 'Rebuild OK for %', pkg_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Rebuild FAILED for %: %', pkg_id, SQLERRM;
    END;
  END LOOP;
END $$;

INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'manual_p1_emergency_bypass_heal_batch',
  'pipeline',
  jsonb_build_object(
    'reason', 'P1 batch heal — 10 packages stuck in HARD_FAIL_REPAIR_EXHAUSTED',
    'bypass_publish_ready_count', 4,
    'rebuild_count', 6,
    'is_repair_marked', 10,
    'failed_jobs_purged', true
  ),
  ARRAY[
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','3e070545-c555-417a-a047-c7541ebb2a7c',
    '96d0fb31-9951-408d-a83e-b2937f5a6af8','d7fd81c3-283e-4270-acef-812b08501442',
    'd2000000-0001-4000-8000-000000000001','5377ab93-fe17-488c-a266-bdb26b672da7',
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b','dd000001-0005-4000-8000-000000000001'
  ]::text[]
);