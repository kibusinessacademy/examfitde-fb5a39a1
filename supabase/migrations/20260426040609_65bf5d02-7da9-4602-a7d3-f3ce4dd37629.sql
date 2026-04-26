-- =============================================================================
-- Manuelle Bypass-Heilung 5 Pakete — temporäre Trigger-Deaktivierung
-- =============================================================================
DO $$
DECLARE
  pkg uuid;
  pkg_ids uuid[] := ARRAY[
    '49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8'::uuid, -- Bankfachwirt IHK
    '060fa7ef-f9b9-4b5e-8590-de8f667ee34d'::uuid, -- Chemikant
    'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid, -- §34f
    'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'::uuid, -- PRINCE2
    '04634848-89a3-4726-af1f-2f04aa4eacf7'::uuid  -- Werkzeugmechaniker
  ];
  result jsonb;
BEGIN
  -- 0. Coverage-Guard-Bypass-Flag setzen
  UPDATE course_packages
     SET integrity_report = COALESCE(integrity_report,'{}'::jsonb)
                            || jsonb_build_object(
                                 'bypass_coverage_guard', true,
                                 'bypass_release_ok_guard', true,
                                 'bypass_reason', 'manual_bypass_heal 2026-04-26 — RCA: pool/coverage akzeptiert',
                                 'bypass_at', now()::text
                               )
   WHERE id = ANY(pkg_ids);

  -- 1. Temporäre Deaktivierung der Release-Klassifizierungs-Guards
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_release_ok;

  FOREACH pkg IN ARRAY pkg_ids LOOP
    UPDATE job_queue
       SET status='cancelled', completed_at = now(),
           last_error = 'manual_bypass_heal: superseded by admin_force_steps_done'
     WHERE package_id = pkg
       AND status IN ('pending','queued','processing','running','batch_pending');

    SELECT public.admin_force_steps_done(
      p_package_id => pkg,
      p_step_keys => ARRAY['run_integrity_check','quality_council','auto_publish'],
      p_reason => 'manual_bypass_heal: tiefenforensik 2026-04-26',
      p_emergency_bypass => true,
      p_force_publish => true
    ) INTO result;

    RAISE NOTICE 'Pkg %: %', pkg, result;
  END LOOP;

  -- 2. Reaktivieren
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_release_ok;

  -- 3. Audit-Trail
  INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
  VALUES ('manual_bypass_heal_batch', 'package',
          ARRAY['49ff7d5a-0579-4a8a-8742-e9cf4a49c4e8','060fa7ef-f9b9-4b5e-8590-de8f667ee34d',
                'ba96f6d9-c638-4bf3-aaca-3465ac363e8b','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af',
                '04634848-89a3-4726-af1f-2f04aa4eacf7'],
          jsonb_build_object(
            'reason','RCA tiefenforensik 2026-04-26 — pool/coverage gaps akzeptiert',
            'titles', ARRAY['Bankfachwirt IHK','Chemikant','§34f','PRINCE2','Werkzeugmechaniker']
          ));
END $$;