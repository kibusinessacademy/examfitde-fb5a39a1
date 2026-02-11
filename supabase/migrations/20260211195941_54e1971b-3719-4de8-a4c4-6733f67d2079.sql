
-- Council 10 Phase 2-4: Anomaly Scoring, Review Queue, Bot-Net, Seat Misuse, Step-Up OTP, Security Reports

-- ========== PHASE 2 ==========

-- 1) Anomaly thresholds (SSOT)
CREATE TABLE IF NOT EXISTS public.security_anomaly_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE DEFAULT 'default',
  w_ip_change numeric NOT NULL DEFAULT 0.25,
  w_device_new numeric NOT NULL DEFAULT 0.25,
  w_fail_spike numeric NOT NULL DEFAULT 0.30,
  w_rate_limit numeric NOT NULL DEFAULT 0.20,
  review_threshold numeric NOT NULL DEFAULT 0.55,
  block_threshold numeric NOT NULL DEFAULT 0.80,
  window_minutes int NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_anomaly_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_security_anomaly_config ON public.security_anomaly_config;
CREATE POLICY deny_all_security_anomaly_config ON public.security_anomaly_config FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_security_anomaly_config ON public.security_anomaly_config;
CREATE POLICY admin_all_security_anomaly_config ON public.security_anomaly_config FOR ALL USING (is_admin(auth.uid()));

INSERT INTO public.security_anomaly_config(name) VALUES ('default')
ON CONFLICT (name) DO NOTHING;

-- 2) column_exists RPC
CREATE OR REPLACE FUNCTION public.column_exists(p_table text, p_column text, p_schema text DEFAULT 'public')
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = p_schema AND table_name = p_table AND column_name = p_column
  );
$$;

-- 3) Admin block/unblock RPCs
CREATE OR REPLACE FUNCTION public.admin_block_user(
  p_user_id uuid,
  p_until timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.security_blocks(user_id, blocked_until, reason)
  VALUES (p_user_id, p_until, p_reason)
  ON CONFLICT (user_id)
  DO UPDATE SET blocked_until = EXCLUDED.blocked_until, reason = EXCLUDED.reason, updated_at = now();

  INSERT INTO public.security_events(event_type, user_id, decision, reason, meta)
  VALUES ('admin_block', p_user_id, 'block', p_reason, jsonb_build_object('blocked_until', p_until));
END $$;

CREATE OR REPLACE FUNCTION public.admin_unblock_user(
  p_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.security_blocks WHERE user_id = p_user_id;
  INSERT INTO public.security_events(event_type, user_id, decision, reason)
  VALUES ('admin_unblock', p_user_id, 'allow', p_reason);
END $$;

-- 4) Admin reset code lockout
CREATE OR REPLACE FUNCTION public.admin_reset_code_lockout(
  p_code text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.license_code_lockouts WHERE license_code = upper(trim(p_code));
  INSERT INTO public.security_events(event_type, license_code, decision, reason, meta)
  VALUES ('claim_locked', upper(trim(p_code)), 'allow', 'admin_reset_code_lockout', jsonb_build_object('note', p_note));
END $$;

-- 5) Security spike detection
CREATE OR REPLACE FUNCTION public.get_security_spike_score(p_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_total int; v_block int; v_rate int; v_fail int; v_score numeric;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE decision='block'),
         COUNT(*) FILTER (WHERE event_type='rate_limited'),
         COUNT(*) FILTER (WHERE event_type='claim_failed')
  INTO v_total, v_block, v_rate, v_fail
  FROM public.security_events
  WHERE created_at >= now() - make_interval(mins => p_minutes);

  IF COALESCE(v_total,0) = 0 THEN v_score := 0;
  ELSE v_score := (COALESCE(v_block,0)::numeric / v_total::numeric) * 0.45 +
                  (COALESCE(v_rate,0)::numeric / v_total::numeric) * 0.35 +
                  (COALESCE(v_fail,0)::numeric / v_total::numeric) * 0.20;
  END IF;

  RETURN jsonb_build_object('minutes', p_minutes, 'total', COALESCE(v_total,0),
    'blocked', COALESCE(v_block,0), 'rate_limited', COALESCE(v_rate,0),
    'failed', COALESCE(v_fail,0), 'score', v_score);
END $$;

-- 6) Security gate -> QA findings
CREATE OR REPLACE FUNCTION public.security_gate_check_and_raise(
  p_minutes int DEFAULT 60,
  p_threshold numeric DEFAULT 0.35
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v jsonb; v_score numeric;
BEGIN
  v := public.get_security_spike_score(p_minutes);
  v_score := COALESCE((v->>'score')::numeric, 0);

  IF v_score >= p_threshold THEN
    PERFORM public.upsert_qa_finding('errors', 'high', 'Security spike detected',
      'Security Events spike (blocks/rate limits/fails) exceeds threshold. Investigate possible abuse.', v, NULL);
  ELSE
    PERFORM public.resolve_qa_finding_if_exists('errors', 'Security spike detected');
  END IF;

  RETURN v;
END $$;

-- ========== PHASE 3 ==========

DO $$ BEGIN
  CREATE TYPE public.security_review_status AS ENUM ('open','approved','blocked','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7) Review queue
CREATE TABLE IF NOT EXISTS public.security_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.security_events(id) ON DELETE CASCADE,
  user_id uuid NULL,
  license_code text NULL,
  seat_id uuid NULL,
  score numeric NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  status public.security_review_status NOT NULL DEFAULT 'open',
  decided_by uuid NULL,
  decided_at timestamptz NULL,
  decision_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_security_reviews_status_time
ON public.security_reviews(status, updated_at DESC);

ALTER TABLE public.security_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_security_reviews ON public.security_reviews;
CREATE POLICY deny_all_security_reviews ON public.security_reviews FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_security_reviews ON public.security_reviews;
CREATE POLICY admin_all_security_reviews ON public.security_reviews FOR ALL USING (is_admin(auth.uid()));

-- 8) Enqueue review (idempotent)
CREATE OR REPLACE FUNCTION public.enqueue_security_review(
  p_event_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_license_code text DEFAULT NULL,
  p_seat_id uuid DEFAULT NULL,
  p_score numeric DEFAULT NULL,
  p_reasons text[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.security_reviews(event_id, user_id, license_code, seat_id, score, reasons)
  VALUES (p_event_id, p_user_id, p_license_code, p_seat_id, p_score, COALESCE(p_reasons,'{}'))
  ON CONFLICT (event_id) DO UPDATE SET
    updated_at = now(),
    score = COALESCE(EXCLUDED.score, public.security_reviews.score),
    reasons = CASE WHEN array_length(EXCLUDED.reasons,1) IS NULL THEN public.security_reviews.reasons ELSE EXCLUDED.reasons END
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 9) Admin decide on review
CREATE OR REPLACE FUNCTION public.admin_decide_security_review(
  p_review_id uuid,
  p_status public.security_review_status,
  p_note text DEFAULT NULL,
  p_block_until timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_user uuid; v_code text;
BEGIN
  SELECT user_id, license_code INTO v_user, v_code
  FROM public.security_reviews WHERE id = p_review_id;

  UPDATE public.security_reviews
  SET status = p_status, decided_by = auth.uid(), decided_at = now(),
      decision_note = p_note, updated_at = now()
  WHERE id = p_review_id;

  IF p_status = 'blocked' AND v_user IS NOT NULL THEN
    PERFORM public.admin_block_user(v_user, p_block_until, COALESCE(p_note,'security_review_block'));
  END IF;
END $$;

-- 10) Bot-net: IP burst
CREATE OR REPLACE FUNCTION public.detect_ip_burst(
  p_minutes int DEFAULT 15,
  p_user_threshold int DEFAULT 8
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v record;
BEGIN
  SELECT ip_hash, COUNT(*) AS events, COUNT(DISTINCT user_id) AS distinct_users
  INTO v
  FROM public.security_events
  WHERE created_at >= now() - make_interval(mins => p_minutes) AND ip_hash IS NOT NULL
  GROUP BY ip_hash HAVING COUNT(DISTINCT user_id) >= p_user_threshold
  ORDER BY COUNT(DISTINCT user_id) DESC LIMIT 1;

  IF v.ip_hash IS NULL THEN RETURN jsonb_build_object('burst', false); END IF;
  RETURN jsonb_build_object('burst', true, 'type', 'ip_burst', 'minutes', p_minutes,
    'ip_hash', v.ip_hash, 'events', v.events, 'distinct_users', v.distinct_users);
END $$;

-- 11) Bot-net: device burst
CREATE OR REPLACE FUNCTION public.detect_device_burst(
  p_minutes int DEFAULT 60,
  p_user_threshold int DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v record;
BEGIN
  SELECT device_hash, COUNT(*) AS events, COUNT(DISTINCT user_id) AS distinct_users
  INTO v
  FROM public.security_events
  WHERE created_at >= now() - make_interval(mins => p_minutes) AND device_hash IS NOT NULL
  GROUP BY device_hash HAVING COUNT(DISTINCT user_id) >= p_user_threshold
  ORDER BY COUNT(DISTINCT user_id) DESC LIMIT 1;

  IF v.device_hash IS NULL THEN RETURN jsonb_build_object('burst', false); END IF;
  RETURN jsonb_build_object('burst', true, 'type', 'device_burst', 'minutes', p_minutes,
    'device_hash', v.device_hash, 'events', v.events, 'distinct_users', v.distinct_users);
END $$;

-- 12) Auto-block user based on fail/RL spikes
CREATE OR REPLACE FUNCTION public.auto_block_user_if_needed(
  p_user_id uuid,
  p_minutes int DEFAULT 30,
  p_fail_threshold int DEFAULT 6,
  p_block_seconds int DEFAULT 1800
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_fail int; v_rl int; v_now timestamptz := now(); v_until timestamptz;
BEGIN
  SELECT COUNT(*) FILTER (WHERE event_type='claim_failed'),
         COUNT(*) FILTER (WHERE event_type='rate_limited')
  INTO v_fail, v_rl
  FROM public.security_events
  WHERE user_id = p_user_id AND created_at >= v_now - make_interval(mins => p_minutes);

  IF COALESCE(v_fail,0) >= p_fail_threshold OR COALESCE(v_rl,0) >= 2 THEN
    v_until := v_now + make_interval(secs => p_block_seconds);
    PERFORM public.admin_block_user(p_user_id, v_until, 'auto_block_abuse_spike');
    RETURN jsonb_build_object('blocked', true, 'blocked_until', v_until, 'fail', v_fail, 'rate_limited', v_rl);
  END IF;
  RETURN jsonb_build_object('blocked', false, 'fail', v_fail, 'rate_limited', v_rl);
END $$;

-- ========== PHASE 4 ==========

-- 13) Step-up OTP challenges
CREATE TABLE IF NOT EXISTS public.security_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  otp_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'claim_stepup',
  expires_at timestamptz NOT NULL,
  verified_at timestamptz NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_otp_user_purpose
ON public.security_otp_challenges(user_id, purpose, created_at DESC);

ALTER TABLE public.security_otp_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_security_otp_challenges ON public.security_otp_challenges;
CREATE POLICY deny_all_security_otp_challenges ON public.security_otp_challenges FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_security_otp_challenges ON public.security_otp_challenges;
CREATE POLICY admin_all_security_otp_challenges ON public.security_otp_challenges FOR ALL USING (is_admin(auth.uid()));

-- 14) Seat misuse tracking
CREATE TABLE IF NOT EXISTS public.seat_device_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_hash text NOT NULL,
  ip_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seat_device_log_seat_time
ON public.seat_device_log(seat_id, created_at DESC);

ALTER TABLE public.seat_device_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_seat_device_log ON public.seat_device_log;
CREATE POLICY deny_all_seat_device_log ON public.seat_device_log FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_seat_device_log ON public.seat_device_log;
CREATE POLICY admin_all_seat_device_log ON public.seat_device_log FOR ALL USING (is_admin(auth.uid()));

-- 15) Seat misuse detector: distinct devices per seat in window
CREATE OR REPLACE FUNCTION public.detect_seat_misuse(
  p_hours int DEFAULT 48,
  p_device_threshold int DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v record;
BEGIN
  SELECT seat_id, user_id, COUNT(DISTINCT device_hash) AS distinct_devices, COUNT(*) AS events
  INTO v
  FROM public.seat_device_log
  WHERE created_at >= now() - make_interval(hours => p_hours)
  GROUP BY seat_id, user_id
  HAVING COUNT(DISTINCT device_hash) >= p_device_threshold
  ORDER BY COUNT(DISTINCT device_hash) DESC LIMIT 1;

  IF v.seat_id IS NULL THEN RETURN jsonb_build_object('misuse', false); END IF;
  RETURN jsonb_build_object('misuse', true, 'seat_id', v.seat_id, 'user_id', v.user_id,
    'distinct_devices', v.distinct_devices, 'events', v.events, 'hours', p_hours);
END $$;

-- 16) Security report export helper
CREATE OR REPLACE FUNCTION public.get_security_report(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int DEFAULT 1000
) RETURNS TABLE (
  event_id uuid,
  event_type text,
  decision text,
  user_id uuid,
  license_code text,
  ip_hash text,
  device_hash text,
  reason text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id, event_type::text, decision::text, user_id, license_code,
         ip_hash, device_hash, reason, created_at
  FROM public.security_events
  WHERE created_at >= p_from AND created_at <= p_to
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
