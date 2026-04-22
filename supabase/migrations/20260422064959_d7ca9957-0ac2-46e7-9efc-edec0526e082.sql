
DO $$
DECLARE
  v_pkgs uuid[] := ARRAY[
    'd2000000-0010-4000-8000-000000000001'::uuid,
    '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2',
    'dd000001-0005-4000-8000-000000000001',
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b',
    'd7fd81c3-283e-4270-acef-812b08501442',
    '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
    '3e070545-c555-417a-a047-c7541ebb2a7c',
    '8acce74a-4f16-4589-a9b3-1b3c37961404'
  ];
  v_zombies uuid[] := ARRAY[
    '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2'::uuid,
    '8acce74a-4f16-4589-a9b3-1b3c37961404'
  ];
BEGIN
  UPDATE job_queue
     SET status='cancelled', completed_at=now(),
         last_error=COALESCE(last_error,'')||' | manual_heal_v1: zombie_cancel'
   WHERE package_id = ANY(v_zombies)
     AND status IN ('pending','processing');

  UPDATE course_packages
     SET status = CASE WHEN status='blocked' THEN 'building' ELSE status END,
         blocked_reason = NULL,
         updated_at = now()
   WHERE id = ANY(v_pkgs);

  UPDATE package_steps
     SET status='queued', started_at=NULL, finished_at=NULL, last_error=NULL,
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'allow_regression', true,
           'allow_regression_by','admin_manual',
           'reset_by','manual_heal_v1','reset_at',now(),
           'reset_reason','blocked_packages_bulk_heal')
   WHERE package_id = ANY(v_pkgs)
     AND step_key IN ('auto_publish','validate_exam_pool','run_integrity_check','quality_council','promote_blueprint_variants','validate_blueprint_variants','repair_exam_pool_quality','generate_blueprint_variants');

  INSERT INTO admin_notifications (severity, category, title, body, entity_type, metadata)
  VALUES ('info','heal',
    'Bulk Heal: 8 blockierte Pakete',
    '6 Pakete mit Variant-Fanout (375 Jobs enqueued), 2 Zombie-Pakete entkernt. Steps requeued, blocked_reason cleared.',
    'package',
    jsonb_build_object('packages', v_pkgs, 'zombies', v_zombies));
END $$;
