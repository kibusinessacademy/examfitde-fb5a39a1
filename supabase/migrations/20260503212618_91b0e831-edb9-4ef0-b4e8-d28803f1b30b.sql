-- Phase A: Atomic-Nudge für die 4 hängenden Pakete (Real-Run, nicht Dry).
-- Ergebnisse landen in auto_heal_log via admin_nudge_atomic_trigger.
DO $$
DECLARE
  pkg uuid;
  res jsonb;
  pkgs uuid[] := ARRAY[
    '586c6a12-3042-46d2-8981-5d7645b2cbf6', -- Betonfertigteilbauer
    '4866a5b0-1430-4ab3-825b-141605d99612', -- Sportfachmann/-frau
    'a02cde5e-a0ad-45fc-a5db-ffe239d387f5', -- Koch/Köchin
    'a9f19137-a004-4850-838a-bdc8f8a705f5'  -- Steuerfachangestellter
  ]::uuid[];
BEGIN
  FOREACH pkg IN ARRAY pkgs LOOP
    BEGIN
      SELECT public.admin_nudge_atomic_trigger(pkg, false) INTO res;
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('manual_nudge_phase_a', 'package', pkg, 'success', 'admin_nudge_atomic_trigger executed', res);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('manual_nudge_phase_a', 'package', pkg, 'error', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
    END;
  END LOOP;
END $$;