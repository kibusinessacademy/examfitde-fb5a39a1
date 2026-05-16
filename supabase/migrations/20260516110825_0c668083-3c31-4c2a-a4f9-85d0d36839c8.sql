-- =========================================================================
-- Track 5 — Mobile Foundation Phase 1: Re-Entry + Push + Notification Prefs
-- =========================================================================

-- 1) Push subscriptions ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learner_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text,
  auth_key text,
  platform text NOT NULL DEFAULT 'web' CHECK (platform IN ('web','ios','android')),
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_learner_push_subs_user ON public.learner_push_subscriptions(user_id) WHERE revoked_at IS NULL;
ALTER TABLE public.learner_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lps_owner_all ON public.learner_push_subscriptions;
CREATE POLICY lps_owner_all ON public.learner_push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS lps_admin_select ON public.learner_push_subscriptions;
CREATE POLICY lps_admin_select ON public.learner_push_subscriptions
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

-- 2) Notification prefs ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learner_notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_push boolean NOT NULL DEFAULT true,
  channel_email boolean NOT NULL DEFAULT true,
  quiet_hours_start text NOT NULL DEFAULT '22:00',
  quiet_hours_end text NOT NULL DEFAULT '07:00',
  fatigue_suppress boolean NOT NULL DEFAULT true,
  exam_window_escalation boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Europe/Berlin',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.learner_notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lnp_owner_all ON public.learner_notification_prefs;
CREATE POLICY lnp_owner_all ON public.learner_notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS lnp_admin_select ON public.learner_notification_prefs;
CREATE POLICY lnp_admin_select ON public.learner_notification_prefs
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

-- 3) Re-Entry events ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learner_re_entry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'app_open','resume_clicked','push_received','push_opened',
    'rescue_accepted','rescue_dismissed','reminder_seen',
    'session_resumed','streak_recovered','daily_challenge_started'
  )),
  source text NOT NULL DEFAULT 'web',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_re_entry_events_user_time ON public.learner_re_entry_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_re_entry_events_type ON public.learner_re_entry_events(event_type, created_at DESC);
ALTER TABLE public.learner_re_entry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lree_owner_insert ON public.learner_re_entry_events;
CREATE POLICY lree_owner_insert ON public.learner_re_entry_events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS lree_owner_select ON public.learner_re_entry_events;
CREATE POLICY lree_owner_select ON public.learner_re_entry_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS lree_admin_select ON public.learner_re_entry_events;
CREATE POLICY lree_admin_select ON public.learner_re_entry_events
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

-- 4) Re-Entry State RPC ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_get_re_entry_state(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_last_at timestamptz;
  v_days_since int;
  v_streak_current int := 0;
  v_streak_longest int := 0;
  v_phase text := 'unscheduled';
  v_days_to_exam int;
  v_intensity text := 'normal';
  v_action jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('error','not_authenticated');
  END IF;

  SELECT MAX(session_started_at) INTO v_last_at
  FROM public.learning_session_patterns
  WHERE user_id = v_user
    AND (p_curriculum_id IS NULL OR curriculum_id = p_curriculum_id);

  v_days_since := CASE WHEN v_last_at IS NULL THEN NULL
                       ELSE EXTRACT(DAY FROM (now() - v_last_at))::int END;

  SELECT current_streak, longest_streak
    INTO v_streak_current, v_streak_longest
  FROM public.user_learning_streaks
  WHERE user_id = v_user
    AND (p_curriculum_id IS NULL OR curriculum_id = p_curriculum_id)
  ORDER BY updated_at DESC
  LIMIT 1;

  SELECT phase, days_to_exam, intensity_recommendation
    INTO v_phase, v_days_to_exam, v_intensity
  FROM public.exam_window_states
  WHERE user_id = v_user
    AND (p_curriculum_id IS NULL OR curriculum_id = p_curriculum_id)
  ORDER BY computed_at DESC
  LIMIT 1;

  -- Suggested action: simple deterministic ladder
  v_action := CASE
    WHEN v_intensity = 'wind_down' THEN
      jsonb_build_object('key','rest_today','label','Heute Pause — Erholung empfohlen','deeplink','/dashboard')
    WHEN v_days_since IS NULL THEN
      jsonb_build_object('key','start_first','label','Erste Lerneinheit starten','deeplink','/dashboard')
    WHEN v_days_since >= 3 AND COALESCE(v_streak_current,0) > 0 THEN
      jsonb_build_object('key','recover_streak','label','Streak retten — kurze Einheit','deeplink','/dashboard?action=resume')
    WHEN v_phase IN ('sharpen','final') THEN
      jsonb_build_object('key','sim_session','label','Simulation jetzt','deeplink','/exam-trainer')
    WHEN COALESCE(v_days_since,0) = 0 THEN
      jsonb_build_object('key','continue_today','label','Heute weiterlernen','deeplink','/dashboard?action=resume')
    ELSE
      jsonb_build_object('key','resume','label','Weiterlernen','deeplink','/dashboard?action=resume')
  END;

  -- Audit (best-effort, never blocks)
  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, meta)
    VALUES (
      'learner_re_entry_state_call',
      'learner',
      'ok',
      jsonb_build_object(
        'user_id', v_user,
        'curriculum_id', p_curriculum_id,
        'days_since_last', v_days_since,
        'phase', v_phase,
        'action_key', v_action->>'key'
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'last_session_at', v_last_at,
    'days_since_last', v_days_since,
    'streak_current', COALESCE(v_streak_current,0),
    'streak_longest', COALESCE(v_streak_longest,0),
    'exam_phase', v_phase,
    'days_to_exam', v_days_to_exam,
    'intensity_recommendation', v_intensity,
    'suggested_action', v_action,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learner_get_re_entry_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_get_re_entry_state(uuid) TO authenticated;

-- 5) updated_at triggers --------------------------------------------------
DROP TRIGGER IF EXISTS trg_lps_updated_at ON public.learner_push_subscriptions;
CREATE TRIGGER trg_lps_updated_at BEFORE UPDATE ON public.learner_push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_lnp_updated_at ON public.learner_notification_prefs;
CREATE TRIGGER trg_lnp_updated_at BEFORE UPDATE ON public.learner_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();