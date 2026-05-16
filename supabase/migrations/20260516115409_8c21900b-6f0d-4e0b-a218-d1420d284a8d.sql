
-- =========================================================
-- Track 5 Phase 4 — Outcome Loop + Guardrails
-- =========================================================

-- 1) Attribution event table -------------------------------
CREATE TABLE IF NOT EXISTS public.notification_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.notification_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'notification_opened',
    'reentry_from_push',
    'session_started_from_notification',
    'minicheck_started_from_notification',
    'minicheck_completed_from_notification',
    'mastery_delta_post_notification',
    'readiness_recovery_post_rescue'
  )),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT notification_events_unique_per_kind UNIQUE (job_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_notif_events_user_time
  ON public.notification_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_events_type_time
  ON public.notification_events (event_type, occurred_at DESC);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ne_owner_select ON public.notification_events;
CREATE POLICY ne_owner_select ON public.notification_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS ne_admin_select ON public.notification_events;
CREATE POLICY ne_admin_select ON public.notification_events
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
-- No INSERT/UPDATE/DELETE policy → writes only via SECURITY DEFINER fn.

-- 2) Learner-facing recorder (auth required) ---------------
CREATE OR REPLACE FUNCTION public.record_notification_event(
  p_job_id UUID,
  p_event_type TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_job RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT user_id, kind INTO v_job
  FROM public.notification_jobs WHERE id = p_job_id;

  IF NOT FOUND OR v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'job_not_found_or_forbidden';
  END IF;

  IF p_event_type NOT IN (
    'notification_opened',
    'reentry_from_push',
    'session_started_from_notification',
    'minicheck_started_from_notification',
    'minicheck_completed_from_notification',
    'mastery_delta_post_notification',
    'readiness_recovery_post_rescue'
  ) THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;

  INSERT INTO public.notification_events (job_id, user_id, event_type, metadata)
  VALUES (p_job_id, v_uid, p_event_type, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (job_id, event_type) DO NOTHING;

  RETURN p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_notification_event(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_notification_event(UUID, TEXT, JSONB) TO authenticated;

-- 3) Learner Trust UX — recent notifications + reasons ----
CREATE OR REPLACE FUNCTION public.learner_get_recent_notifications(p_limit INT DEFAULT 20)
RETURNS TABLE(
  job_id UUID,
  kind TEXT,
  channel TEXT,
  state TEXT,
  suppression_reason TEXT,
  scheduled_for TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  payload JSONB,
  was_opened BOOLEAN,
  opened_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.id, j.kind, j.channel, j.state, j.suppression_reason,
    j.scheduled_for, j.delivered_at, j.payload,
    EXISTS (
      SELECT 1 FROM public.notification_events e
      WHERE e.job_id = j.id AND e.event_type = 'notification_opened'
    ) AS was_opened,
    (
      SELECT MIN(occurred_at) FROM public.notification_events e
      WHERE e.job_id = j.id AND e.event_type = 'notification_opened'
    ) AS opened_at
  FROM public.notification_jobs j
  WHERE j.user_id = auth.uid()
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.learner_get_recent_notifications(INT) TO authenticated;

-- 4) Admin: attribution funnel -----------------------------
CREATE OR REPLACE FUNCTION public.admin_get_notification_attribution(
  p_window_hours INT DEFAULT 168
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - make_interval(hours => GREATEST(1, p_window_hours));
  v_delivered INT;
  v_opened INT;
  v_reentry INT;
  v_session INT;
  v_minicheck_started INT;
  v_minicheck_completed INT;
  v_mastery_delta INT;
  v_rescue_total INT;
  v_rescue_recovery INT;
  v_by_kind JSONB;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*) INTO v_delivered FROM public.notification_jobs
    WHERE state = 'delivered' AND delivered_at >= v_since;

  SELECT
    COUNT(*) FILTER (WHERE event_type='notification_opened'),
    COUNT(*) FILTER (WHERE event_type='reentry_from_push'),
    COUNT(*) FILTER (WHERE event_type='session_started_from_notification'),
    COUNT(*) FILTER (WHERE event_type='minicheck_started_from_notification'),
    COUNT(*) FILTER (WHERE event_type='minicheck_completed_from_notification'),
    COUNT(*) FILTER (WHERE event_type='mastery_delta_post_notification'),
    COUNT(*) FILTER (WHERE event_type='readiness_recovery_post_rescue')
  INTO v_opened, v_reentry, v_session, v_minicheck_started,
       v_minicheck_completed, v_mastery_delta, v_rescue_recovery
  FROM public.notification_events
  WHERE occurred_at >= v_since;

  SELECT COUNT(*) INTO v_rescue_total FROM public.notification_jobs
    WHERE kind='rescue' AND state='delivered' AND delivered_at >= v_since;

  SELECT COALESCE(jsonb_object_agg(kind, cnt), '{}'::jsonb) INTO v_by_kind
  FROM (
    SELECT j.kind, COUNT(DISTINCT e.job_id) AS cnt
    FROM public.notification_events e
    JOIN public.notification_jobs j ON j.id = e.job_id
    WHERE e.occurred_at >= v_since AND e.event_type='notification_opened'
    GROUP BY j.kind
  ) t;

  RETURN jsonb_build_object(
    'window_hours', p_window_hours,
    'delivered', v_delivered,
    'opened', v_opened,
    'reentry', v_reentry,
    'session_started', v_session,
    'minicheck_started', v_minicheck_started,
    'minicheck_completed', v_minicheck_completed,
    'mastery_delta_events', v_mastery_delta,
    'rescue_delivered', v_rescue_total,
    'rescue_recovery', v_rescue_recovery,
    'open_rate_pct', CASE WHEN v_delivered>0 THEN ROUND(100.0*v_opened/v_delivered, 1) ELSE NULL END,
    'session_per_open_pct', CASE WHEN v_opened>0 THEN ROUND(100.0*v_session/v_opened, 1) ELSE NULL END,
    'rescue_recovery_pct', CASE WHEN v_rescue_total>0 THEN ROUND(100.0*v_rescue_recovery/v_rescue_total, 1) ELSE NULL END,
    'opened_by_kind', v_by_kind
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_notification_attribution(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_attribution(INT) TO authenticated;

-- 5) Admin: suppression-quality ----------------------------
CREATE OR REPLACE FUNCTION public.admin_get_suppression_quality(
  p_window_hours INT DEFAULT 168
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - make_interval(hours => GREATEST(1, p_window_hours));
  v_total INT;
  v_suppressed INT;
  v_delivered INT;
  v_by_reason JSONB;
  v_fatigue INT;
  v_quiet INT;
  v_optout INT;
  v_cooldown INT;
  v_cap INT;
  v_escalation_overrides INT;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.notification_jobs WHERE created_at >= v_since;
  SELECT COUNT(*) INTO v_suppressed FROM public.notification_jobs
    WHERE created_at >= v_since AND state='suppressed';
  SELECT COUNT(*) INTO v_delivered FROM public.notification_jobs
    WHERE created_at >= v_since AND state='delivered';

  SELECT COALESCE(jsonb_object_agg(suppression_reason, cnt), '{}'::jsonb) INTO v_by_reason
  FROM (
    SELECT COALESCE(suppression_reason,'unknown') AS suppression_reason, COUNT(*) AS cnt
    FROM public.notification_jobs
    WHERE created_at >= v_since AND state='suppressed'
    GROUP BY 1
  ) t;

  v_fatigue  := COALESCE((v_by_reason->>'fatigue_suppress')::int, 0)
              + COALESCE((v_by_reason->>'wind_down')::int, 0);
  v_quiet    := COALESCE((v_by_reason->>'quiet_hours')::int, 0);
  v_optout   := COALESCE((v_by_reason->>'channel_optout')::int, 0);
  v_cooldown := COALESCE((v_by_reason->>'same_kind_cooldown')::int, 0);
  v_cap      := COALESCE((v_by_reason->>'daily_cap')::int, 0)
              + COALESCE((v_by_reason->>'max_per_day')::int, 0);

  SELECT COUNT(*) INTO v_escalation_overrides
  FROM public.notification_jobs j
  WHERE created_at >= v_since
    AND state IN ('delivered','sending','pending')
    AND (payload ? 'exam_window_override' OR (payload->>'escalated')::boolean IS TRUE);

  RETURN jsonb_build_object(
    'window_hours', p_window_hours,
    'jobs_total', v_total,
    'jobs_suppressed', v_suppressed,
    'jobs_delivered', v_delivered,
    'suppression_pct', CASE WHEN v_total>0 THEN ROUND(100.0*v_suppressed/v_total, 1) ELSE NULL END,
    'by_reason', v_by_reason,
    'fatigue', v_fatigue,
    'quiet_hours', v_quiet,
    'channel_optout', v_optout,
    'same_kind_cooldown', v_cooldown,
    'daily_cap', v_cap,
    'exam_window_overrides', v_escalation_overrides,
    -- Heuristic signals:
    'signal_over_suppression', (v_total>50 AND v_suppressed::float/NULLIF(v_total,0) > 0.7),
    'signal_under_send', (v_total<5 AND p_window_hours >= 24),
    'signal_fatigue_dominant', (v_fatigue::float/NULLIF(v_suppressed,0) > 0.6)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_suppression_quality(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_suppression_quality(INT) TO authenticated;

-- 6) Admin: system-health (no_vapid, stale cron, drops, etc.)
CREATE OR REPLACE FUNCTION public.admin_get_notification_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_subs INT;
  v_last_delivery TIMESTAMPTZ;
  v_last_attempt TIMESTAMPTZ;
  v_pending INT;
  v_pending_stale INT;
  v_failed_1h INT;
  v_delivered_1h INT;
  v_delivered_24h INT;
  v_invalid_token_1h INT;
  v_suppressed_1h INT;
  v_total_1h INT;
  v_cron_last TIMESTAMPTZ;
  v_cron_stale BOOLEAN;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*) INTO v_active_subs
    FROM public.learner_push_subscriptions WHERE revoked_at IS NULL;

  SELECT MAX(delivered_at) INTO v_last_delivery FROM public.notification_jobs;
  SELECT MAX(last_attempt_at) INTO v_last_attempt FROM public.notification_jobs;

  SELECT COUNT(*) INTO v_pending FROM public.notification_jobs WHERE state='pending';
  SELECT COUNT(*) INTO v_pending_stale FROM public.notification_jobs
    WHERE state='pending' AND scheduled_for < now() - interval '10 minutes';

  SELECT COUNT(*) INTO v_failed_1h FROM public.notification_jobs
    WHERE state='failed' AND last_attempt_at >= now()-interval '1 hour';
  SELECT COUNT(*) INTO v_delivered_1h FROM public.notification_jobs
    WHERE state='delivered' AND delivered_at >= now()-interval '1 hour';
  SELECT COUNT(*) INTO v_delivered_24h FROM public.notification_jobs
    WHERE state='delivered' AND delivered_at >= now()-interval '24 hours';

  SELECT COUNT(*) INTO v_invalid_token_1h
  FROM public.notification_jobs
  WHERE state='failed' AND last_attempt_at >= now()-interval '1 hour'
    AND (delivery_result::text ILIKE '%410%' OR delivery_result::text ILIKE '%404%' OR delivery_result::text ILIKE '%invalid%');

  SELECT COUNT(*) FILTER (WHERE state='suppressed'),
         COUNT(*)
  INTO v_suppressed_1h, v_total_1h
  FROM public.notification_jobs
  WHERE created_at >= now() - interval '1 hour';

  -- Cron staleness: best-effort via auto_heal_log of dispatcher cron tier
  BEGIN
    SELECT MAX(created_at) INTO v_cron_last
    FROM public.auto_heal_log
    WHERE action_type IN ('notification_dispatch','cron_tick','notification_dispatch_run')
       OR target_id::text ILIKE '%notification%';
  EXCEPTION WHEN OTHERS THEN v_cron_last := NULL; END;
  v_cron_stale := (v_cron_last IS NOT NULL AND v_cron_last < now()-interval '10 minutes')
               OR (v_cron_last IS NULL AND v_last_attempt IS NOT NULL AND v_last_attempt < now()-interval '30 minutes');

  RETURN jsonb_build_object(
    'active_subscriptions', v_active_subs,
    'last_delivery_at', v_last_delivery,
    'last_attempt_at', v_last_attempt,
    'pending', v_pending,
    'pending_stale', v_pending_stale,
    'failed_1h', v_failed_1h,
    'delivered_1h', v_delivered_1h,
    'delivered_24h', v_delivered_24h,
    'invalid_token_1h', v_invalid_token_1h,
    'suppression_pct_1h', CASE WHEN v_total_1h>0 THEN ROUND(100.0*v_suppressed_1h/v_total_1h,1) ELSE NULL END,
    'cron_last_seen_at', v_cron_last,
    'signal_no_subscriptions', (v_active_subs = 0),
    'signal_cron_stale', v_cron_stale,
    'signal_delivery_drop', (v_delivered_24h > 5 AND v_delivered_1h = 0),
    'signal_invalid_token_spike', (v_invalid_token_1h >= 5),
    'signal_suppression_spike', (v_total_1h > 20 AND v_suppressed_1h::float/NULLIF(v_total_1h,0) > 0.8),
    'signal_pending_stale', (v_pending_stale > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_notification_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_health() TO authenticated;
