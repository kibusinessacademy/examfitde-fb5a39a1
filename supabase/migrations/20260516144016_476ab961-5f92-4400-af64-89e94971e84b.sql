
-- =============================================================
-- Track M4: Renewal-Reverse + Auto-Promote Upsell + Owner-Digest Email Flush
-- =============================================================

-- ---------- 1. Stripe Renewal-Reverse Trigger ----------
-- When a license is reactivated (cancel_at_period_end true→false, or status canceled→active,
-- or ends_at extended into the future), suppress pending org_seat_expiring* notifications
-- for that org's owners/admins.

CREATE OR REPLACE FUNCTION public.fn_reverse_renewal_notifications_on_license_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reverse boolean := false;
  v_reason text := NULL;
  v_suppressed_count int := 0;
  v_recipient_ids uuid[];
BEGIN
  -- Detect reversal scenarios
  IF (OLD.cancel_at_period_end = true AND NEW.cancel_at_period_end = false) THEN
    v_reverse := true;
    v_reason := 'renewal_reversed_cancel_undone';
  ELSIF (OLD.status <> 'active' AND NEW.status = 'active') THEN
    v_reverse := true;
    v_reason := 'renewal_reversed_status_reactivated';
  ELSIF (OLD.ends_at IS NOT NULL AND NEW.ends_at IS NOT NULL 
         AND NEW.ends_at > OLD.ends_at + interval '7 days'
         AND NEW.ends_at > now() + interval '32 days') THEN
    v_reverse := true;
    v_reason := 'renewal_reversed_ends_at_extended';
  END IF;

  IF NOT v_reverse THEN
    RETURN NEW;
  END IF;

  -- Collect recipients (owners + admins of the org)
  SELECT array_agg(DISTINCT user_id) INTO v_recipient_ids
  FROM public.org_memberships
  WHERE org_id = NEW.org_id AND role IN ('owner', 'admin');

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Suppress pending renewal-warning jobs
  WITH upd AS (
    UPDATE public.notification_jobs
    SET state = 'suppressed',
        suppression_reason = v_reason,
        updated_at = now()
    WHERE state = 'pending'
      AND kind IN ('org_seat_expiring', 'org_seat_expiring_critical')
      AND user_id = ANY(v_recipient_ids)
      AND (payload->>'license_id')::uuid = NEW.id
    RETURNING 1
  )
  SELECT count(*) INTO v_suppressed_count FROM upd;

  -- Audit
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, payload)
  VALUES (
    'm4_renewal_reverse',
    'org_license',
    NEW.id,
    'ok',
    jsonb_build_object(
      'reason', v_reason,
      'org_id', NEW.org_id,
      'suppressed_jobs', v_suppressed_count,
      'recipients_count', array_length(v_recipient_ids, 1),
      'old_ends_at', OLD.ends_at,
      'new_ends_at', NEW.ends_at,
      'old_status', OLD.status,
      'new_status', NEW.status,
      'old_cape', OLD.cancel_at_period_end,
      'new_cape', NEW.cancel_at_period_end
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the underlying UPDATE
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, payload)
  VALUES ('m4_renewal_reverse', 'org_license', NEW.id, 'error',
    jsonb_build_object('error', SQLERRM));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_m4_reverse_renewal_notifications ON public.org_licenses;
CREATE TRIGGER trg_m4_reverse_renewal_notifications
AFTER UPDATE OF cancel_at_period_end, status, ends_at ON public.org_licenses
FOR EACH ROW
WHEN (OLD.cancel_at_period_end IS DISTINCT FROM NEW.cancel_at_period_end
   OR OLD.status IS DISTINCT FROM NEW.status
   OR OLD.ends_at IS DISTINCT FROM NEW.ends_at)
EXECUTE FUNCTION public.fn_reverse_renewal_notifications_on_license_change();

-- ---------- 2. Auto-Promote Upsell Suggestions ----------
CREATE OR REPLACE FUNCTION public.fn_auto_promote_upsell_suggestions(
  p_min_confidence numeric DEFAULT 0.15,
  p_min_support int DEFAULT 5,
  p_min_lift numeric DEFAULT 1.2,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidates int := 0;
  v_promoted int := 0;
  v_skipped int := 0;
  v_promoted_ids jsonb := '[]'::jsonb;
  r record;
  v_path_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  FOR r IN
    SELECT id, source_curriculum_id, target_curriculum_id, confidence, support_count, lift
    FROM public.curriculum_upsell_path_suggestions
    WHERE status = 'pending'
      AND confidence >= p_min_confidence
      AND support_count >= p_min_support
      AND lift >= p_min_lift
    ORDER BY confidence DESC, support_count DESC
    LIMIT 50
  LOOP
    v_candidates := v_candidates + 1;

    IF p_dry_run THEN
      v_promoted_ids := v_promoted_ids || jsonb_build_object(
        'suggestion_id', r.id, 'confidence', r.confidence, 'support', r.support_count, 'lift', r.lift, 'mode', 'dry_run'
      );
      CONTINUE;
    END IF;

    -- Skip if active path already exists
    IF EXISTS (
      SELECT 1 FROM public.curriculum_upsell_paths
      WHERE source_curriculum_id = r.source_curriculum_id
        AND target_curriculum_id = r.target_curriculum_id
        AND enabled = true
    ) THEN
      UPDATE public.curriculum_upsell_path_suggestions
      SET status = 'superseded', reviewed_at = now(),
          notes = COALESCE(notes,'') || ' [auto: path already active]'
      WHERE id = r.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.curriculum_upsell_paths (source_curriculum_id, target_curriculum_id, weight, reason, enabled)
    VALUES (r.source_curriculum_id, r.target_curriculum_id, GREATEST(r.confidence, 0.1), 'auto_promoted_m4', true)
    ON CONFLICT (source_curriculum_id, target_curriculum_id) DO UPDATE
      SET enabled = true, weight = GREATEST(EXCLUDED.weight, public.curriculum_upsell_paths.weight)
    RETURNING id INTO v_path_id;

    UPDATE public.curriculum_upsell_path_suggestions
    SET status = 'approved',
        reviewed_at = now(),
        promoted_path_id = v_path_id,
        notes = COALESCE(notes,'') || ' [auto-promoted M4]'
    WHERE id = r.id;

    v_promoted := v_promoted + 1;
    v_promoted_ids := v_promoted_ids || jsonb_build_object(
      'suggestion_id', r.id, 'path_id', v_path_id, 'confidence', r.confidence
    );
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, payload)
  VALUES ('m4_upsell_auto_promote', 'system',
          CASE WHEN p_dry_run THEN 'noop' ELSE 'ok' END,
          jsonb_build_object(
            'candidates', v_candidates, 'promoted', v_promoted, 'skipped', v_skipped,
            'min_confidence', p_min_confidence, 'min_support', p_min_support, 'min_lift', p_min_lift,
            'dry_run', p_dry_run, 'items', v_promoted_ids
          ));

  RETURN jsonb_build_object(
    'candidates', v_candidates, 'promoted', v_promoted, 'skipped', v_skipped,
    'dry_run', p_dry_run, 'items', v_promoted_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_promote_upsell_suggestions(numeric,int,numeric,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_promote_upsell_suggestions(numeric,int,numeric,boolean) TO service_role;

-- ---------- 3. Owner-Digest Email Channel Flip ----------
-- Promote pending owner-digest jobs to email-channel so the edge function picks them up.
CREATE OR REPLACE FUNCTION public.fn_flip_owner_digest_jobs_to_email()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flipped int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.notification_jobs
    SET channel = 'email', updated_at = now()
    WHERE state = 'pending'
      AND kind = 'org_owner_digest'
      AND channel = 'push'
    RETURNING 1
  )
  SELECT count(*) INTO v_flipped FROM upd;

  RETURN jsonb_build_object('flipped', v_flipped);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_flip_owner_digest_jobs_to_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_flip_owner_digest_jobs_to_email() TO service_role;

-- ---------- 4. Admin RPC: Smoke + Audit ----------
CREATE OR REPLACE FUNCTION public.admin_smoke_track_m4()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promote jsonb;
  v_flip jsonb;
  v_trigger_exists boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_m4_reverse_renewal_notifications'
  ) INTO v_trigger_exists;

  v_promote := public.fn_auto_promote_upsell_suggestions(0.15, 5, 1.2, true);
  v_flip := public.fn_flip_owner_digest_jobs_to_email();

  RETURN jsonb_build_object(
    'reverse_trigger_installed', v_trigger_exists,
    'auto_promote_dry_run', v_promote,
    'owner_digest_email_flip', v_flip,
    'checked_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_smoke_track_m4() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_smoke_track_m4() TO authenticated;

-- ---------- 5. Admin Audit Summary ----------
CREATE OR REPLACE FUNCTION public.admin_get_track_m4_audit(p_window_hours int DEFAULT 168)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reverse jsonb;
  v_promote jsonb;
  v_digest_emails jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  SELECT jsonb_build_object(
    'total_events', count(*),
    'suppressed_jobs', COALESCE(sum((payload->>'suppressed_jobs')::int), 0),
    'last_event_at', max(created_at),
    'recent', COALESCE(jsonb_agg(jsonb_build_object(
      'at', created_at, 'org_license', target_id,
      'reason', payload->>'reason', 'suppressed', payload->>'suppressed_jobs'
    ) ORDER BY created_at DESC) FILTER (WHERE created_at > now() - (p_window_hours || ' hours')::interval), '[]'::jsonb)
  ) INTO v_reverse
  FROM public.auto_heal_log
  WHERE action_type = 'm4_renewal_reverse'
    AND created_at > now() - (p_window_hours || ' hours')::interval;

  SELECT jsonb_build_object(
    'runs', count(*),
    'total_promoted', COALESCE(sum((payload->>'promoted')::int), 0),
    'total_candidates', COALESCE(sum((payload->>'candidates')::int), 0),
    'last_run_at', max(created_at)
  ) INTO v_promote
  FROM public.auto_heal_log
  WHERE action_type = 'm4_upsell_auto_promote'
    AND created_at > now() - (p_window_hours || ' hours')::interval;

  SELECT jsonb_build_object(
    'pending_email_digests', count(*) FILTER (WHERE state = 'pending' AND channel = 'email'),
    'delivered_email_digests', count(*) FILTER (WHERE state = 'delivered' AND channel = 'email'),
    'failed_email_digests', count(*) FILTER (WHERE state = 'failed' AND channel = 'email')
  ) INTO v_digest_emails
  FROM public.notification_jobs
  WHERE kind = 'org_owner_digest'
    AND created_at > now() - (p_window_hours || ' hours')::interval;

  RETURN jsonb_build_object(
    'window_hours', p_window_hours,
    'renewal_reverse', COALESCE(v_reverse, '{}'::jsonb),
    'auto_promote', COALESCE(v_promote, '{}'::jsonb),
    'owner_digest_emails', COALESCE(v_digest_emails, '{}'::jsonb),
    'generated_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_track_m4_audit(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_track_m4_audit(int) TO authenticated;

-- ---------- 6. Cron Schedules ----------
-- Auto-promote weekly (after discovery on Mondays 04:15 → run at 04:45)
SELECT cron.unschedule('upsell-auto-promote-weekly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'upsell-auto-promote-weekly'
);
SELECT cron.schedule(
  'upsell-auto-promote-weekly',
  '45 4 * * 1',
  $cron$ SELECT public.fn_auto_promote_upsell_suggestions(0.15, 5, 1.2, false); $cron$
);

-- Owner-digest email-flip + flush every 10 minutes
SELECT cron.unschedule('owner-digest-email-flush-10min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'owner-digest-email-flush-10min'
);
SELECT cron.schedule(
  'owner-digest-email-flush-10min',
  '*/10 * * * *',
  $cron$
  SELECT public.fn_flip_owner_digest_jobs_to_email();
  SELECT net.http_post(
    url := 'https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/send-org-owner-digest',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('triggered_by','cron')
  );
  $cron$
);
