
-- ============================================================
-- Track M5: Monetization Closure v2
-- ============================================================

-- 1. Owner-Digest tracking columns
ALTER TABLE public.org_owner_digests
  ADD COLUMN IF NOT EXISTS tracking_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tracked_recipients jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_owner_digests_token
  ON public.org_owner_digests(tracking_token);

-- 2. Digest events table
CREATE TABLE IF NOT EXISTS public.org_owner_digest_events (
  id           bigserial PRIMARY KEY,
  digest_id    uuid NOT NULL REFERENCES public.org_owner_digests(id) ON DELETE CASCADE,
  recipient    text NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN ('open','click')),
  link_url     text,
  user_agent   text,
  ip_hash      text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (digest_id, recipient, event_type, link_url)
);

CREATE INDEX IF NOT EXISTS idx_ood_events_digest_time
  ON public.org_owner_digest_events(digest_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ood_events_type_time
  ON public.org_owner_digest_events(event_type, occurred_at DESC);

ALTER TABLE public.org_owner_digest_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ood_events_admin_read" ON public.org_owner_digest_events;
CREATE POLICY "ood_events_admin_read"
  ON public.org_owner_digest_events FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "ood_events_service_write" ON public.org_owner_digest_events;
CREATE POLICY "ood_events_service_write"
  ON public.org_owner_digest_events FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Service role RPC for edge function to record events
CREATE OR REPLACE FUNCTION public.admin_record_owner_digest_event(
  p_token       uuid,
  p_recipient   text,
  p_event_type  text,
  p_link_url    text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL,
  p_ip_hash     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_digest_id uuid;
BEGIN
  IF p_event_type NOT IN ('open','click') THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_event_type');
  END IF;

  SELECT id INTO v_digest_id
  FROM public.org_owner_digests
  WHERE tracking_token = p_token
  LIMIT 1;

  IF v_digest_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason','token_not_found');
  END IF;

  INSERT INTO public.org_owner_digest_events(
    digest_id, recipient, event_type, link_url, user_agent, ip_hash
  ) VALUES (
    v_digest_id, lower(coalesce(p_recipient,'unknown')),
    p_event_type, p_link_url, p_user_agent, p_ip_hash
  )
  ON CONFLICT (digest_id, recipient, event_type, link_url) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'digest_id', v_digest_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_owner_digest_event(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_owner_digest_event(uuid,text,text,text,text,text) TO service_role;

-- ============================================================
-- 3. Auto-Promote Tuning per persona / curriculum
-- ============================================================
CREATE TABLE IF NOT EXISTS public.curriculum_upsell_promote_tuning (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona           text NOT NULL DEFAULT '__default__',
  source_curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  min_confidence    numeric(5,4) NOT NULL DEFAULT 0.15,
  min_support       integer      NOT NULL DEFAULT 5,
  min_lift          numeric(8,4) NOT NULL DEFAULT 1.2,
  max_promote_per_run integer    NOT NULL DEFAULT 25,
  enabled           boolean      NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (persona, source_curriculum_id)
);

ALTER TABLE public.curriculum_upsell_promote_tuning ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cupt_admin_all" ON public.curriculum_upsell_promote_tuning;
CREATE POLICY "cupt_admin_all"
  ON public.curriculum_upsell_promote_tuning FOR ALL
  TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Seed default row if missing
INSERT INTO public.curriculum_upsell_promote_tuning (persona, source_curriculum_id, min_confidence, min_support, min_lift, max_promote_per_run, notes)
SELECT '__default__', NULL, 0.15, 5, 1.2, 25, 'M5 default tuning'
WHERE NOT EXISTS (
  SELECT 1 FROM public.curriculum_upsell_promote_tuning
  WHERE persona = '__default__' AND source_curriculum_id IS NULL
);

-- v2 auto-promote: walks tuning rows
CREATE OR REPLACE FUNCTION public.fn_auto_promote_upsell_suggestions_v2()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tuning record;
  v_total_promoted int := 0;
  v_total_candidates int := 0;
  v_per_tuning jsonb := '[]'::jsonb;
  v_promoted_now int;
  v_candidates_now int;
BEGIN
  FOR v_tuning IN
    SELECT * FROM public.curriculum_upsell_promote_tuning
    WHERE enabled = true
    ORDER BY (source_curriculum_id IS NULL) ASC, persona
  LOOP
    -- Count candidates matching tuning
    SELECT count(*) INTO v_candidates_now
    FROM public.curriculum_upsell_path_suggestions s
    WHERE s.status = 'pending'
      AND s.confidence >= v_tuning.min_confidence
      AND s.support_count >= v_tuning.min_support
      AND s.lift >= v_tuning.min_lift
      AND (v_tuning.source_curriculum_id IS NULL OR s.source_curriculum_id = v_tuning.source_curriculum_id);

    -- Promote up to max_promote_per_run
    WITH eligible AS (
      SELECT s.id, s.source_curriculum_id, s.target_curriculum_id, s.confidence
      FROM public.curriculum_upsell_path_suggestions s
      WHERE s.status = 'pending'
        AND s.confidence >= v_tuning.min_confidence
        AND s.support_count >= v_tuning.min_support
        AND s.lift >= v_tuning.min_lift
        AND (v_tuning.source_curriculum_id IS NULL OR s.source_curriculum_id = v_tuning.source_curriculum_id)
      ORDER BY s.confidence DESC, s.lift DESC
      LIMIT v_tuning.max_promote_per_run
    ),
    upsert AS (
      INSERT INTO public.curriculum_upsell_paths (source_curriculum_id, target_curriculum_id, weight, reason, enabled)
      SELECT source_curriculum_id, target_curriculum_id, GREATEST(confidence, 0.1), 'auto_promoted_v2:'||v_tuning.persona, true
      FROM eligible
      ON CONFLICT (source_curriculum_id, target_curriculum_id)
      DO UPDATE SET weight = GREATEST(public.curriculum_upsell_paths.weight, EXCLUDED.weight),
                    enabled = true,
                    reason  = EXCLUDED.reason
      RETURNING source_curriculum_id, target_curriculum_id
    )
    UPDATE public.curriculum_upsell_path_suggestions s
       SET status = 'approved',
           reviewed_at = now(),
           notes = coalesce(s.notes,'') || ' | auto_v2:' || v_tuning.persona,
           updated_at = now()
      FROM upsert u
     WHERE s.source_curriculum_id = u.source_curriculum_id
       AND s.target_curriculum_id = u.target_curriculum_id
       AND s.status = 'pending';

    GET DIAGNOSTICS v_promoted_now = ROW_COUNT;
    v_total_promoted   := v_total_promoted + v_promoted_now;
    v_total_candidates := v_total_candidates + v_candidates_now;

    v_per_tuning := v_per_tuning || jsonb_build_object(
      'persona', v_tuning.persona,
      'source_curriculum_id', v_tuning.source_curriculum_id,
      'candidates', v_candidates_now,
      'promoted', v_promoted_now
    );
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, payload)
  VALUES (
    'm5_auto_promote_upsell_v2', 'system', 'success',
    jsonb_build_object('total_promoted', v_total_promoted, 'total_candidates', v_total_candidates, 'per_tuning', v_per_tuning)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'total_promoted', v_total_promoted,
    'total_candidates', v_total_candidates,
    'per_tuning', v_per_tuning
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_promote_upsell_suggestions_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_promote_upsell_suggestions_v2() TO service_role;

-- Cron weekly Mo 04:55 (after v1 04:45)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upsell-auto-promote-v2-weekly') THEN
    PERFORM cron.schedule(
      'upsell-auto-promote-v2-weekly',
      '55 4 * * 1',
      $cron$ SELECT public.fn_auto_promote_upsell_suggestions_v2(); $cron$
    );
  END IF;
END $$;

-- ============================================================
-- 4. Renewal Re-Emit Trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_m5_reemit_after_reverse()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recent_reverse int := 0;
  v_jobs_emitted int := 0;
BEGIN
  BEGIN
    -- Only re-emit when license re-enters at-risk state
    IF NOT (
      (OLD.cancel_at_period_end = false AND NEW.cancel_at_period_end = true)
      OR (OLD.status = 'active' AND NEW.status IN ('cancelled','past_due'))
      OR (OLD.ends_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.ends_at < OLD.ends_at - interval '1 day')
    ) THEN
      RETURN NEW;
    END IF;

    -- Was there a reverse in the last 30 days?
    SELECT count(*) INTO v_recent_reverse
    FROM public.auto_heal_log
    WHERE action_type = 'm4_renewal_reverse'
      AND created_at >= now() - interval '30 days'
      AND (payload->>'license_id')::uuid = NEW.id;

    IF v_recent_reverse = 0 THEN
      RETURN NEW;
    END IF;

    -- Re-enqueue fresh expiring intents for license owners/admins
    INSERT INTO public.notification_jobs (user_id, kind, status, payload, scheduled_at)
    SELECT DISTINCT om.user_id,
           'org_seat_expiring_critical',
           'pending',
           jsonb_build_object('license_id', NEW.id, 'org_id', NEW.org_id, 'reemit', true),
           now()
    FROM public.org_memberships om
    WHERE om.org_id = NEW.org_id
      AND om.role IN ('owner','admin');

    GET DIAGNOSTICS v_jobs_emitted = ROW_COUNT;

    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, payload)
    VALUES (
      'm5_renewal_re_emit', 'org_license', NEW.id, 'success',
      jsonb_build_object(
        'license_id', NEW.id,
        'org_id', NEW.org_id,
        'reverse_count_30d', v_recent_reverse,
        'jobs_emitted', v_jobs_emitted,
        'trigger_reason',
          CASE WHEN OLD.cancel_at_period_end = false AND NEW.cancel_at_period_end = true THEN 're_cancelled'
               WHEN OLD.status = 'active' AND NEW.status IN ('cancelled','past_due') THEN 'status_dropped'
               ELSE 'ends_at_shortened' END
      )
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, payload)
    VALUES ('m5_renewal_re_emit', 'org_license', NEW.id, 'error',
            jsonb_build_object('error', SQLERRM));
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_m5_reemit_after_reverse ON public.org_licenses;
CREATE TRIGGER trg_m5_reemit_after_reverse
  AFTER UPDATE OF cancel_at_period_end, status, ends_at ON public.org_licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_m5_reemit_after_reverse();

-- ============================================================
-- 5. Audit RPC + Smoke
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_track_m5_audit(p_window_hours int DEFAULT 168)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open_events int;
  v_click_events int;
  v_unique_open_recipients int;
  v_unique_click_recipients int;
  v_promote_v2_runs int;
  v_promote_v2_total int;
  v_reemit_events int;
  v_reemit_jobs int;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    count(*) FILTER (WHERE event_type='open'),
    count(*) FILTER (WHERE event_type='click'),
    count(DISTINCT recipient) FILTER (WHERE event_type='open'),
    count(DISTINCT recipient) FILTER (WHERE event_type='click')
  INTO v_open_events, v_click_events, v_unique_open_recipients, v_unique_click_recipients
  FROM public.org_owner_digest_events
  WHERE occurred_at >= now() - make_interval(hours => p_window_hours);

  SELECT
    count(*),
    coalesce(sum( (payload->>'total_promoted')::int ), 0)
  INTO v_promote_v2_runs, v_promote_v2_total
  FROM public.auto_heal_log
  WHERE action_type='m5_auto_promote_upsell_v2'
    AND created_at >= now() - make_interval(hours => p_window_hours);

  SELECT
    count(*),
    coalesce(sum( (payload->>'jobs_emitted')::int ), 0)
  INTO v_reemit_events, v_reemit_jobs
  FROM public.auto_heal_log
  WHERE action_type='m5_renewal_re_emit'
    AND result_status='success'
    AND created_at >= now() - make_interval(hours => p_window_hours);

  RETURN jsonb_build_object(
    'window_hours', p_window_hours,
    'digest_tracking', jsonb_build_object(
      'open_events', v_open_events,
      'click_events', v_click_events,
      'unique_open_recipients', v_unique_open_recipients,
      'unique_click_recipients', v_unique_click_recipients
    ),
    'auto_promote_v2', jsonb_build_object(
      'runs', v_promote_v2_runs,
      'total_promoted', v_promote_v2_total
    ),
    'renewal_re_emit', jsonb_build_object(
      'events', v_reemit_events,
      'jobs_emitted', v_reemit_jobs
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_track_m5_audit(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_track_m5_audit(int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_smoke_track_m5()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tuning_default_exists boolean;
  v_trigger_installed boolean;
  v_token_column boolean;
  v_dry jsonb;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.curriculum_upsell_promote_tuning
                 WHERE persona='__default__' AND source_curriculum_id IS NULL)
    INTO v_tuning_default_exists;

  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_m5_reemit_after_reverse')
    INTO v_trigger_installed;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='org_owner_digests' AND column_name='tracking_token'
  ) INTO v_token_column;

  -- dry: just check candidates count via tuning view (no mutation)
  SELECT jsonb_build_object(
    'tunings_enabled', (SELECT count(*) FROM public.curriculum_upsell_promote_tuning WHERE enabled),
    'pending_suggestions', (SELECT count(*) FROM public.curriculum_upsell_path_suggestions WHERE status='pending')
  ) INTO v_dry;

  RETURN jsonb_build_object(
    'ok', v_tuning_default_exists AND v_trigger_installed AND v_token_column,
    'tuning_default_exists', v_tuning_default_exists,
    'reemit_trigger_installed', v_trigger_installed,
    'tracking_token_column', v_token_column,
    'dry', v_dry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_smoke_track_m5() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_smoke_track_m5() TO authenticated, service_role;
