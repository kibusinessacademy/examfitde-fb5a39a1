-- =========================================================================
-- Track 5 Phase 2 — Notification Outbox + Suppression Engine + Streak Decider
-- =========================================================================

-- 1) Outbox table --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'daily_reminder','rescue','streak_recovery',
    'exam_countdown','weak_competency','readiness_summary'
  )),
  channel text NOT NULL DEFAULT 'push' CHECK (channel IN ('push','email')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending','suppressed','sending','delivered','failed','expired'
  )),
  suppression_reason text,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_payload jsonb,
  delivery_result jsonb,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notif_jobs_pending
  ON public.notification_jobs(scheduled_for)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_notif_jobs_user_time
  ON public.notification_jobs(user_id, created_at DESC);

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nj_owner_select ON public.notification_jobs;
CREATE POLICY nj_owner_select ON public.notification_jobs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS nj_admin_select ON public.notification_jobs;
CREATE POLICY nj_admin_select ON public.notification_jobs
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

DROP TRIGGER IF EXISTS trg_nj_updated_at ON public.notification_jobs;
CREATE TRIGGER trg_nj_updated_at BEFORE UPDATE ON public.notification_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Suppression engine --------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_notification_should_suppress(
  p_user_id uuid,
  p_kind text,
  p_now timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefs public.learner_notification_prefs%ROWTYPE;
  v_local timestamptz;
  v_hhmm text;
  v_qs text; v_qe text;
  v_in_quiet boolean := false;
  v_rest boolean := false;
  v_intensity text;
  v_phase text;
  v_recent_count int;
  v_recent_same int;
BEGIN
  SELECT * INTO v_prefs FROM public.learner_notification_prefs WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    -- defaults: allow, but apply baseline quiet hours 22-07
    v_prefs.channel_push := true;
    v_prefs.channel_email := true;
    v_prefs.quiet_hours_start := '22:00';
    v_prefs.quiet_hours_end := '07:00';
    v_prefs.fatigue_suppress := true;
    v_prefs.exam_window_escalation := true;
    v_prefs.timezone := 'Europe/Berlin';
  END IF;

  IF NOT v_prefs.channel_push THEN
    RETURN 'channel_disabled';
  END IF;

  -- Quiet hours (with overnight wrap)
  v_local := p_now AT TIME ZONE v_prefs.timezone;
  v_hhmm := to_char(v_local, 'HH24:MI');
  v_qs := v_prefs.quiet_hours_start;
  v_qe := v_prefs.quiet_hours_end;
  IF v_qs < v_qe THEN
    v_in_quiet := v_hhmm >= v_qs AND v_hhmm < v_qe;
  ELSE
    v_in_quiet := v_hhmm >= v_qs OR v_hhmm < v_qe;
  END IF;

  -- Exam-window escalation can pierce quiet hours ONLY for rescue/exam_countdown in final/taper
  SELECT phase, intensity_recommendation INTO v_phase, v_intensity
    FROM public.exam_window_states
    WHERE user_id = p_user_id
    ORDER BY computed_at DESC LIMIT 1;

  IF v_in_quiet THEN
    IF v_prefs.exam_window_escalation
       AND p_kind IN ('rescue','exam_countdown')
       AND v_phase IN ('final','taper') THEN
      -- allowed to pierce
      NULL;
    ELSE
      RETURN 'quiet_hours';
    END IF;
  END IF;

  -- Fatigue / cognitive rest
  IF v_prefs.fatigue_suppress THEN
    IF v_intensity = 'wind_down' AND p_kind NOT IN ('rescue') THEN
      RETURN 'fatigue_wind_down';
    END IF;
  END IF;

  -- Rate limits: max 3 delivered+sending pushes per 24h, max 1 same-kind per 30min
  SELECT COUNT(*) INTO v_recent_count
    FROM public.notification_jobs
    WHERE user_id = p_user_id
      AND channel = 'push'
      AND state IN ('sending','delivered')
      AND created_at > p_now - interval '24 hours';
  IF v_recent_count >= 3 AND p_kind <> 'rescue' THEN
    RETURN 'daily_cap_3';
  END IF;

  SELECT COUNT(*) INTO v_recent_same
    FROM public.notification_jobs
    WHERE user_id = p_user_id
      AND kind = p_kind
      AND state IN ('pending','sending','delivered')
      AND created_at > p_now - interval '30 minutes';
  IF v_recent_same >= 1 THEN
    RETURN 'cooldown_30min';
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_notification_should_suppress(uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_notification_should_suppress(uuid,text,timestamptz) TO authenticated, service_role;

-- 3) Enqueue (single choke-point) ----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_enqueue_notification(
  p_user_id uuid,
  p_kind text,
  p_curriculum_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dedupe text;
  v_suppress text;
  v_state text;
  v_id uuid;
  v_existing uuid;
BEGIN
  v_dedupe := COALESCE(p_dedupe_key, p_kind || ':' || to_char(p_scheduled_for,'YYYYMMDDHH24'));
  SELECT id INTO v_existing FROM public.notification_jobs
    WHERE user_id = p_user_id AND kind = p_kind AND dedupe_key = v_dedupe;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status','idempotent','job_id', v_existing);
  END IF;

  v_suppress := public.fn_notification_should_suppress(p_user_id, p_kind, p_scheduled_for);
  v_state := CASE WHEN v_suppress IS NULL THEN 'pending' ELSE 'suppressed' END;

  INSERT INTO public.notification_jobs(
    user_id, curriculum_id, kind, channel, state, suppression_reason,
    dedupe_key, payload, scheduled_for
  ) VALUES (
    p_user_id, p_curriculum_id, p_kind, 'push', v_state, v_suppress,
    v_dedupe, COALESCE(p_payload,'{}'::jsonb), p_scheduled_for
  ) RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.auto_heal_log(action_type,target_type,result_status,meta)
    VALUES ('notification_enqueue','learner',
      CASE WHEN v_state='pending' THEN 'ok' ELSE 'skipped' END,
      jsonb_build_object(
        'user_id',p_user_id,'kind',p_kind,'state',v_state,
        'suppression_reason',v_suppress,'job_id',v_id,'dedupe_key',v_dedupe
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('status', v_state, 'job_id', v_id, 'suppression_reason', v_suppress);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_enqueue_notification(uuid,text,uuid,jsonb,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_notification(uuid,text,uuid,jsonb,text,timestamptz) TO service_role;

-- 4) Streak recovery decider --------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_streak_recovery_decide()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Berlin')::date;
  v_enqueued int := 0;
  v_suppressed int := 0;
  v_scanned int := 0;
  r record;
  v_res jsonb;
BEGIN
  FOR r IN
    SELECT s.user_id, s.curriculum_id, s.current_streak, s.last_activity_date
    FROM public.user_learning_streaks s
    JOIN public.learner_course_grants g
      ON g.user_id = s.user_id AND g.curriculum_id = s.curriculum_id
     AND g.status = 'active'
    WHERE s.last_activity_date IS NOT NULL
      AND s.last_activity_date < v_today
      AND (
        (s.current_streak >= 2 AND s.last_activity_date = v_today - 1)
        OR s.last_activity_date <= v_today - 3
      )
  LOOP
    v_scanned := v_scanned + 1;
    v_res := public.fn_enqueue_notification(
      r.user_id,
      'streak_recovery',
      r.curriculum_id,
      jsonb_build_object(
        'streak', r.current_streak,
        'last_activity', r.last_activity_date,
        'days_inactive', (v_today - r.last_activity_date),
        'title', 'Kurze Einheit reicht',
        'body', CASE
          WHEN r.current_streak >= 2 AND r.last_activity_date = v_today - 1
            THEN 'Heute 10 Minuten halten deinen Lernrhythmus stabil.'
          ELSE 'Lass uns wieder einsteigen — eine kleine Einheit genügt.'
        END,
        'deeplink','/dashboard?action=resume'
      ),
      'streak_recovery:' || to_char(v_today,'YYYYMMDD'),
      now()
    );
    IF v_res->>'status' = 'pending' THEN v_enqueued := v_enqueued + 1;
    ELSIF v_res->>'status' = 'suppressed' THEN v_suppressed := v_suppressed + 1;
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.auto_heal_log(action_type,target_type,result_status,meta)
    VALUES ('streak_recovery_decide','system','ok',
      jsonb_build_object('date',v_today,'scanned',v_scanned,'enqueued',v_enqueued,'suppressed',v_suppressed));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('scanned',v_scanned,'enqueued',v_enqueued,'suppressed',v_suppressed);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_streak_recovery_decide() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_streak_recovery_decide() TO service_role;

-- 5) Dispatcher claim + delivery record ---------------------------------
CREATE OR REPLACE FUNCTION public.admin_notification_claim_batch(p_limit int DEFAULT 20)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.notification_jobs
    WHERE state = 'pending'
      AND scheduled_for <= now()
      AND expires_at > now()
    ORDER BY scheduled_for ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_jobs nj
    SET state = 'sending',
        attempts = attempts + 1,
        last_attempt_at = now()
  FROM claimed c
  WHERE nj.id = c.id
  RETURNING nj.*;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_notification_claim_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_notification_claim_batch(int) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_record_notification_delivery(
  p_job_id uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_result jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempts int;
BEGIN
  IF p_status NOT IN ('delivered','failed') THEN
    RAISE EXCEPTION 'invalid status %', p_status;
  END IF;
  SELECT attempts INTO v_attempts FROM public.notification_jobs WHERE id = p_job_id;
  IF p_status = 'delivered' THEN
    UPDATE public.notification_jobs
      SET state='delivered', delivered_at=now(), delivery_result = COALESCE(p_result,'{}'::jsonb)
      WHERE id = p_job_id;
  ELSE
    -- failed: retry up to 3 attempts, then mark failed
    IF v_attempts >= 3 THEN
      UPDATE public.notification_jobs
        SET state='failed', delivery_result = jsonb_build_object('error',p_error) || COALESCE(p_result,'{}'::jsonb)
        WHERE id = p_job_id;
    ELSE
      UPDATE public.notification_jobs
        SET state='pending',
            scheduled_for = now() + (v_attempts * interval '5 minutes'),
            delivery_result = jsonb_build_object('last_error',p_error)
        WHERE id = p_job_id;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_record_notification_delivery(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_notification_delivery(uuid,text,text,jsonb) TO service_role;