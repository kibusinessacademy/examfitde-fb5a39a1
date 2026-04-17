DO $$
DECLARE
  pkg_id uuid;
BEGIN
  FOR pkg_id IN SELECT unnest(ARRAY[
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid,
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid,
    'd7fd81c3-283e-4270-acef-812b08501442'::uuid,
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid
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

-- is_repair für Bonus-WIP
UPDATE course_packages
SET is_repair = true, updated_at = now()
WHERE id IN (
  'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8',
  'd7fd81c3-283e-4270-acef-812b08501442','ba96f6d9-c638-4bf3-aaca-3465ac363e8b'
);

INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'manual_p1_hard_rebuild_4_remaining',
  'pipeline',
  jsonb_build_object('reason','P1 hard rebuild: 4 blocked pkg without approved questions','count',4),
  ARRAY['bae6fc7b-6c03-4716-aeb5-5a84d9bb83af','49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8',
        'd7fd81c3-283e-4270-acef-812b08501442','ba96f6d9-c638-4bf3-aaca-3465ac363e8b']::text[]
);