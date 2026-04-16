-- ══════════════════════════════════════════════════════════
-- HEAL 8 BLOCKED PACKAGES (exclude intentional_pause)
-- ══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2'::uuid, -- Fachinformatiker Digitale Vernetzung
    '348c9ef9-b359-49f0-98ed-cd4a01a51522'::uuid, -- Fachinformatiker Daten-/Prozessanalyse
    '3e070545-c555-417a-a047-c7541ebb2a7c'::uuid, -- Immobiliardarlehensvermittler
    '5377ab93-fe17-488c-a266-bdb26b672da7'::uuid, -- Kaufmann Büromanagement
    '96d0fb31-9951-408d-a83e-b2937f5a6af8'::uuid, -- Fachinformatiker Systemintegration
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid, -- Finanzanlagenvermittler
    'fa931e34-52ee-4296-889f-303575b088d5'::uuid, -- Immobilienmakler
    'd7fd81c3-283e-4270-acef-812b08501442'::uuid  -- Technischer Produktdesigner
  ];
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY v_pkg_ids LOOP
    -- 1) Reset validate_exam_pool step: clear terminal markers, reset to queued
    UPDATE package_steps
    SET status = 'queued',
        last_error = NULL,
        meta = jsonb_build_object(
          'healed_at', now()::text,
          'healed_by', 'migration_heal_blocked_packages',
          'previous_stall_reason', COALESCE(meta->>'stall_reason_code', 'unknown'),
          'consecutive_no_progress', 0
        ),
        updated_at = now()
    WHERE package_id = v_id
      AND step_key = 'validate_exam_pool';

    -- 2) Also reset generate_oral_exam if it has a stall error (Immobilienmakler)
    UPDATE package_steps
    SET status = 'queued',
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'healed_at', now()::text,
          'healed_by', 'migration_heal_blocked_packages'
        ),
        updated_at = now()
    WHERE package_id = v_id
      AND step_key = 'generate_oral_exam'
      AND last_error IS NOT NULL;

    -- 3) Reset any other failed steps to queued
    UPDATE package_steps
    SET status = 'queued',
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'healed_at', now()::text,
          'healed_by', 'migration_heal_blocked_packages'
        ),
        updated_at = now()
    WHERE package_id = v_id
      AND status = 'failed';

    -- 4) Cancel all stale failed jobs for this package
    UPDATE job_queue
    SET status = 'cancelled',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'heal_blocked_package',
          'cancelled_at', now()::text
        ),
        updated_at = now()
    WHERE package_id = v_id
      AND status = 'failed';

    -- 5) Set package back to building
    UPDATE course_packages
    SET status = 'building',
        blocked_reason = NULL,
        updated_at = now()
    WHERE id = v_id
      AND status = 'blocked';

    -- 6) Audit log
    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'heal_blocked_package',
      'migration_heal_blocked_packages',
      'course_package',
      v_id::text,
      'healed',
      'Reset terminal state, cleared HARD_FAIL markers, set back to building',
      jsonb_build_object('package_id', v_id, 'healed_at', now()::text)
    );
  END LOOP;
END $$;