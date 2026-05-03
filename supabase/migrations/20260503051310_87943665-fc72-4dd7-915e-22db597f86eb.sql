-- ─────────────────────────────────────────────────────────────────────
-- 1) Audit-Storm-Stopper im Reverter-Guard
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_block_building_to_queued_revert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_check jsonb;
  v_source text;
  v_recent_audit timestamptz;
  v_pid int := pg_backend_pid();
  v_query text;
BEGIN
  IF NOT (OLD.status = 'building' AND NEW.status = 'queued') THEN
    RETURN NEW;
  END IF;

  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(current_setting('app.transition_source', true), 'unknown_trigger');

  IF v_source IN ('admin_manual', 'admin_soft_reset', 'admin_force_rebuild') THEN
    RETURN NEW;
  END IF;

  v_check := public.fn_package_demote_protected(NEW.id);

  IF (v_check->>'protected')::boolean THEN
    -- BLOCK bleibt erhalten, aber Audit wird gedrosselt: 1× / 15min / package
    SELECT max(created_at) INTO v_recent_audit
      FROM public.auto_heal_log
     WHERE target_id = NEW.id::text
       AND action_type = 'guard_block_building_revert'
       AND created_at > now() - interval '15 minutes';

    IF v_recent_audit IS NULL THEN
      BEGIN
        SELECT query INTO v_query FROM pg_stat_activity WHERE pid = v_pid;
      EXCEPTION WHEN OTHERS THEN v_query := NULL; END;

      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, trigger_source,
         result_status, result_detail, metadata)
      VALUES (
        'guard_block_building_revert', 'package', NEW.id::text, v_source,
        'blocked',
        format('Blocked building→queued revert (approved=%s progress=%s tail=%s) [throttled 15min]',
          v_check->>'approved_questions', v_check->>'build_progress', v_check->>'pending_tail_jobs'),
        jsonb_build_object(
          'protection', v_check,
          'transition_source', v_source,
          'attempted_at', now(),
          'backend_pid', v_pid,
          'caller_query', left(coalesce(v_query,''), 500),
          'throttle_window', '15 minutes'
        )
      );
    END IF;

    NEW.status := 'building';
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Reverter-Detect ebenfalls drosseln (1× / 15min / package)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_detect_status_reverter()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_recent_audit timestamptz;
  v_source text;
BEGIN
  IF NOT (OLD.status = 'building' AND NEW.status IN ('queued','blocked')) THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(current_setting('app.transition_source', true), 'unknown_trigger');

  SELECT max(created_at) INTO v_recent_audit
    FROM public.auto_heal_log
   WHERE target_id = NEW.id::text
     AND action_type = 'PATTERN_X6_STATUS_REVERTER'
     AND created_at > now() - interval '15 minutes';

  IF v_recent_audit IS NOT NULL THEN
    RETURN NEW; -- still detect, just don't audit-spam
  END IF;

  INSERT INTO public.heal_audit_layers
    (package_id, trigger_source, action_type, result_status,
     symptom_before, symptom_after, gate_layer_after, notes)
  VALUES (NEW.id, v_source, 'PATTERN_X6_STATUS_REVERTER', 'warning',
          jsonb_build_object('status', OLD.status, 'blocked_reason', OLD.blocked_reason),
          jsonb_build_object('status', NEW.status, 'blocked_reason', NEW.blocked_reason),
          jsonb_build_object('reverted_at', now(), 'transition_source', v_source, 'throttle_window','15 minutes'),
          format('Pattern X6 [throttled]: %s -> %s | reason=%s', OLD.status, NEW.status, COALESCE(NEW.blocked_reason,'?')));

  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
  VALUES ('PATTERN_X6_STATUS_REVERTER', 'package', NEW.id::text, v_source, 'warning',
          format('Reverter %s -> %s reason=%s', OLD.status, NEW.status, COALESCE(NEW.blocked_reason,'?')),
          jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status,
                             'blocked_reason', NEW.blocked_reason, 'throttle_window','15 minutes'));

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Bypass-Cooldown für die 3 Loop-Pakete (1h)
-- ─────────────────────────────────────────────────────────────────────
SET LOCAL session_replication_role = replica;

UPDATE public.course_packages
SET manual_heal_cooldown_until = now() + interval '1 hour',
    updated_at = now()
WHERE id IN (
  '570ccb3e-2937-4d81-b3d8-624b9be84737',
  '335decc8-9f68-4784-b318-a68f620bf77e',
  '956f203f-fac8-4683-9bd5-db886ee695a7'
);

SET LOCAL session_replication_role = origin;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Forward-Nudge: Tail-Jobs neu erzeugen
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  pkg uuid;
  res jsonb;
BEGIN
  FOREACH pkg IN ARRAY ARRAY[
    '570ccb3e-2937-4d81-b3d8-624b9be84737'::uuid,
    '335decc8-9f68-4784-b318-a68f620bf77e'::uuid,
    '956f203f-fac8-4683-9bd5-db886ee695a7'::uuid
  ]
  LOOP
    BEGIN
      res := public.admin_nudge_atomic_trigger(pkg, false);
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, trigger_source, result_status, metadata)
      VALUES ('control_lane_forensic_fix_v1', 'package', pkg::text,
              'control_lane_forensic_fix_v1', 'done',
              jsonb_build_object('step','nudge', 'result', res));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, trigger_source, result_status, error_message, metadata)
      VALUES ('control_lane_forensic_fix_v1', 'package', pkg::text,
              'control_lane_forensic_fix_v1', 'failed', SQLERRM,
              jsonb_build_object('step','nudge'));
    END;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Final-Audit
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.auto_heal_log
  (action_type, target_type, result_status, metadata)
VALUES (
  'control_lane_forensic_fix_v1', 'system', 'done',
  jsonb_build_object(
    'note','Reverter+Detect throttled to 1/15min/package, 3 loop packages bypassed +1h, nudge attempted',
    'targets', ARRAY['570ccb3e-2937-4d81-b3d8-624b9be84737',
                     '335decc8-9f68-4784-b318-a68f620bf77e',
                     '956f203f-fac8-4683-9bd5-db886ee695a7']
  )
);