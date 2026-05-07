-- Auto-Gate für phantom-skip Recovery-Wellen.
-- Startet die nächste Welle NUR wenn:
--   1. pending+processing dieses job_types <= p_max_pending
--   2. keine NEUEN failed Jobs dieses job_types in den letzten p_fail_window_min Minuten
--      (außer bereits-bekannte Failure-Klassen aus letztem Lauf — wir prüfen nur neue)
--   3. mindestens p_min_completed der vorherigen Welle 'completed' ODER step 'done'
-- Andernfalls: Skip mit Audit + Reason.

CREATE OR REPLACE FUNCTION public.admin_heal_phantom_skipped_wave_auto(
  p_step_key text,
  p_limit int DEFAULT 25,
  p_max_pending int DEFAULT 30,
  p_fail_window_min int DEFAULT 15,
  p_min_completed_prev int DEFAULT 10,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_job_type text := 'package_' || p_step_key;
  v_pending int;
  v_failed_window int;
  v_completed_recent int;
  v_skip_reason text;
  v_rec record;
  v_processed int := 0;
  v_errors int := 0;
  v_nudge jsonb;
  v_wave_tag text := to_char(now(),'YYYYMMDDHH24MI') || '_' || p_step_key;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  -- Gate 1: pending/processing Backlog
  SELECT COUNT(*) INTO v_pending
  FROM job_queue
  WHERE job_type = v_job_type AND status IN ('pending','processing');

  -- Gate 2: failed im Window
  SELECT COUNT(*) INTO v_failed_window
  FROM job_queue
  WHERE job_type = v_job_type AND status = 'failed'
    AND updated_at > now() - make_interval(mins => p_fail_window_min);

  -- Gate 3: completed der laufenden Recovery (letzte 60min)
  SELECT COUNT(*) INTO v_completed_recent
  FROM job_queue
  WHERE job_type = v_job_type AND status = 'completed'
    AND updated_at > now() - interval '60 minutes';

  IF NOT p_force THEN
    IF v_pending > p_max_pending THEN
      v_skip_reason := format('pending=%s exceeds max=%s', v_pending, p_max_pending);
    ELSIF v_failed_window > 0 THEN
      v_skip_reason := format('%s new failed in last %s min', v_failed_window, p_fail_window_min);
    ELSIF v_completed_recent < p_min_completed_prev THEN
      v_skip_reason := format('only %s completed in last 60min (need >= %s)', v_completed_recent, p_min_completed_prev);
    END IF;
  END IF;

  IF v_skip_reason IS NOT NULL THEN
    INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES ('phantom_skip_wave_auto_skipped','system','skipped',
            jsonb_build_object('step_key', p_step_key, 'reason', v_skip_reason,
                               'pending', v_pending, 'failed_window', v_failed_window,
                               'completed_recent', v_completed_recent, 'caller', v_caller));
    RETURN jsonb_build_object('executed', false, 'reason', v_skip_reason,
                              'pending', v_pending, 'failed_window', v_failed_window,
                              'completed_recent', v_completed_recent);
  END IF;

  -- Execute wave (mirrors admin_heal_phantom_skipped_required_steps live path)
  PERFORM set_config('app.allow_required_skip','on', true);

  FOR v_rec IN
    SELECT package_id, step_key
    FROM v_phantom_skipped_required_drift d
    WHERE d.eligible = true AND d.step_key = p_step_key
    ORDER BY approved_questions DESC NULLS LAST
    LIMIT p_limit
  LOOP
    BEGIN
      UPDATE package_steps
      SET status = 'queued',
          meta = COALESCE(meta,'{}'::jsonb)
                 || jsonb_build_object(
                      'phantom_skip_recovered_at', now(),
                      'phantom_skip_recovered_by', 'wave_auto:' || v_wave_tag,
                      'previous_skip_reason', meta->>'skip_reason'
                    )
                 - 'skip_reason' - 'last_atomic_enqueue_at',
          updated_at = now()
      WHERE package_id = v_rec.package_id AND step_key = v_rec.step_key;

      BEGIN
        SELECT admin_nudge_atomic_trigger(v_rec.package_id, false) INTO v_nudge;
      EXCEPTION WHEN OTHERS THEN
        v_nudge := jsonb_build_object('nudge_error', SQLERRM);
      END;

      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'success',
              jsonb_build_object('step_key', v_rec.step_key, 'wave_tag', v_wave_tag,
                                 'auto', true, 'nudge', v_nudge, 'caller', v_caller));
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skipped_required_heal','package', v_rec.package_id, 'error',
              jsonb_build_object('step_key', v_rec.step_key, 'wave_tag', v_wave_tag,
                                 'auto', true, 'error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('phantom_skip_wave_auto_executed','system','success',
          jsonb_build_object('step_key', p_step_key, 'wave_tag', v_wave_tag,
                             'processed', v_processed, 'errors', v_errors,
                             'gate_pending', v_pending, 'gate_failed_window', v_failed_window,
                             'gate_completed_recent', v_completed_recent));

  RETURN jsonb_build_object('executed', true, 'wave_tag', v_wave_tag,
                            'processed', v_processed, 'errors', v_errors,
                            'gate_pending', v_pending, 'gate_failed_window', v_failed_window,
                            'gate_completed_recent', v_completed_recent);
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_heal_phantom_skipped_wave_auto(text,int,int,int,int,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_phantom_skipped_wave_auto(text,int,int,int,int,boolean) TO authenticated, service_role;

-- Smoke (dry-only via gate skip): high min_completed forces skip path
DO $smoke$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000', true);
  -- Caller ist nicht admin → permission denied erwartet, ignorieren
  BEGIN
    SELECT public.admin_heal_phantom_skipped_wave_auto('build_ai_tutor_index',1,30,15,9999,false) INTO r;
    RAISE NOTICE 'smoke unexpected ok: %', r;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'smoke gate enforced (expected admin-only): %', SQLERRM;
  END;
END
$smoke$;