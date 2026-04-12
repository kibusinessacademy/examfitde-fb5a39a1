
-- 1. Drop old function signature (has DEFAULT that conflicts)
DROP FUNCTION IF EXISTS public.quarantine_package(uuid, text);

-- 2. Recreate quarantine_package: idempotent + legacy-aware
CREATE OR REPLACE FUNCTION public.quarantine_package(p_package_id uuid, p_reason text DEFAULT 'manual_quarantine')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status text;
  v_is_exempt boolean;
  v_recent_event_exists boolean;
BEGIN
  SELECT status, legacy_exempt_from_hollow_guard
    INTO v_old_status, v_is_exempt
  FROM public.course_packages
  WHERE id = p_package_id;

  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'package_not_found');
  END IF;

  -- Legacy exemption: skip quarantine, deduped skip-event
  IF v_is_exempt AND p_reason = 'hollow_published_auto_quarantine' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ops_guardrail_events
      WHERE guard_key = 'quarantine_legacy_exempt_skip'
        AND details->>'package_id' = p_package_id::text
        AND created_at > now() - interval '24 hours'
    ) INTO v_recent_event_exists;

    IF NOT v_recent_event_exists THEN
      INSERT INTO public.ops_guardrail_events (guard_key, details)
      VALUES ('quarantine_legacy_exempt_skip', jsonb_build_object(
        'package_id', p_package_id,
        'reason', p_reason,
        'note', 'skipped due to legacy_exempt_from_hollow_guard=true'
      ));
    END IF;

    RETURN jsonb_build_object('success', true, 'note', 'legacy_exempt_skipped', 'package_id', p_package_id);
  END IF;

  -- Already quarantined
  IF v_old_status = 'quality_gate_failed' THEN
    RETURN jsonb_build_object('success', true, 'note', 'already_quarantined', 'package_id', p_package_id);
  END IF;

  -- Dedup: no duplicate event within 24h
  SELECT EXISTS (
    SELECT 1 FROM public.ops_guardrail_events
    WHERE guard_key = 'quarantine'
      AND details->>'package_id' = p_package_id::text
      AND details->>'reason' = p_reason
      AND created_at > now() - interval '24 hours'
  ) INTO v_recent_event_exists;

  -- Perform quarantine
  UPDATE public.course_packages
  SET status = 'quality_gate_failed',
      published_at = NULL,
      integrity_passed = false,
      integrity_report =
        jsonb_set(
          jsonb_set(
            COALESCE(integrity_report, '{}'::jsonb),
            '{verdict}', to_jsonb(p_reason), true
          ),
          '{quarantined_at}', to_jsonb(now()::text), true
        )
        || jsonb_build_object('previous_status', v_old_status)
  WHERE id = p_package_id;

  -- Log only if not deduped
  IF NOT v_recent_event_exists THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('quarantine', jsonb_build_object(
      'package_id', p_package_id,
      'reason', p_reason,
      'previous_status', v_old_status
    ));
  END IF;

  RETURN jsonb_build_object('success', true, 'package_id', p_package_id, 'previous_status', v_old_status);
END;
$$;

-- 3. Admin function: mark_legacy_exempt
CREATE OR REPLACE FUNCTION public.fn_mark_legacy_exempt(
  p_package_id uuid,
  p_reason text,
  p_set_by text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.course_packages
  SET legacy_exempt_from_hollow_guard = true,
      legacy_exempt_reason = p_reason,
      legacy_exempt_set_at = now(),
      legacy_exempt_set_by = p_set_by
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'package_not_found');
  END IF;

  INSERT INTO public.admin_actions (action, scope, user_id, payload, affected_ids)
  VALUES ('mark_legacy_exempt', 'package', null, 
    jsonb_build_object('package_id', p_package_id, 'reason', p_reason, 'set_by', p_set_by),
    ARRAY[p_package_id::text]);

  RETURN jsonb_build_object('success', true, 'package_id', p_package_id);
END;
$$;

-- 4. Admin function: remove_legacy_exempt
CREATE OR REPLACE FUNCTION public.fn_remove_legacy_exempt(
  p_package_id uuid,
  p_set_by text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_reason text;
BEGIN
  SELECT legacy_exempt_reason INTO v_old_reason
  FROM public.course_packages WHERE id = p_package_id;

  UPDATE public.course_packages
  SET legacy_exempt_from_hollow_guard = false,
      legacy_exempt_reason = null,
      legacy_exempt_set_at = null,
      legacy_exempt_set_by = null
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'package_not_found');
  END IF;

  INSERT INTO public.admin_actions (action, scope, user_id, payload, affected_ids)
  VALUES ('remove_legacy_exempt', 'package', null,
    jsonb_build_object('package_id', p_package_id, 'previous_reason', v_old_reason, 'removed_by', p_set_by),
    ARRAY[p_package_id::text]);

  RETURN jsonb_build_object('success', true, 'package_id', p_package_id);
END;
$$;
