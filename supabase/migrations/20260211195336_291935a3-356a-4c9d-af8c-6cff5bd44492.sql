
-- Council 10: Security / Abuse / License Fraud

-- Create is_admin alias if missing (other councils use it)
CREATE OR REPLACE FUNCTION public.is_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin_user(p_uid);
$$;

DO $$ BEGIN
  CREATE TYPE public.security_event_type AS ENUM (
    'claim_attempt','claim_success','claim_failed','claim_locked',
    'rate_limited','device_mismatch','ip_anomaly','seat_bound',
    'admin_block','admin_unblock'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.security_decision AS ENUM ('allow','review','block');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Central audit log for security events
CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type public.security_event_type NOT NULL,
  user_id uuid NULL,
  buyer_account_id uuid NULL,
  license_code text NULL,
  seat_id uuid NULL,
  ip_hash text NULL,
  device_hash text NULL,
  ua_hash text NULL,
  decision public.security_decision NOT NULL DEFAULT 'allow',
  reason text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_time ON public.security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_code_time ON public.security_events(license_code, created_at DESC);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_security_events ON public.security_events FOR ALL USING (false);
CREATE POLICY admin_all_security_events ON public.security_events FOR ALL USING (is_admin(auth.uid()));

-- 2) Rate limit buckets
CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key text NOT NULL UNIQUE,
  window_start timestamptz NOT NULL,
  window_seconds int NOT NULL,
  count int NOT NULL DEFAULT 0,
  blocked_until timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_security_rate_limits ON public.security_rate_limits FOR ALL USING (false);
CREATE POLICY admin_all_security_rate_limits ON public.security_rate_limits FOR ALL USING (is_admin(auth.uid()));

-- 3) Code lockouts
CREATE TABLE IF NOT EXISTS public.license_code_lockouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_code text NOT NULL UNIQUE,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz NULL,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.license_code_lockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_license_code_lockouts ON public.license_code_lockouts FOR ALL USING (false);
CREATE POLICY admin_all_license_code_lockouts ON public.license_code_lockouts FOR ALL USING (is_admin(auth.uid()));

-- 4) Device binding per learner
CREATE TABLE IF NOT EXISTS public.user_device_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_count int NOT NULL DEFAULT 1,
  is_blocked boolean NOT NULL DEFAULT false,
  UNIQUE(user_id, device_hash)
);

ALTER TABLE public.user_device_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_user_device_bindings ON public.user_device_bindings FOR ALL USING (false);
CREATE POLICY admin_all_user_device_bindings ON public.user_device_bindings FOR ALL USING (is_admin(auth.uid()));

-- 5) Admin blocks (user-level)
CREATE TABLE IF NOT EXISTS public.security_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  blocked_until timestamptz NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_security_blocks ON public.security_blocks FOR ALL USING (false);
CREATE POLICY admin_all_security_blocks ON public.security_blocks FOR ALL USING (is_admin(auth.uid()));

-- 6) RPCs

CREATE OR REPLACE FUNCTION public.is_user_blocked(p_user uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.security_blocks
    WHERE user_id = p_user AND (blocked_until IS NULL OR blocked_until > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.security_rate_limit_hit(
  p_bucket_key text, p_window_seconds int, p_max_count int, p_block_seconds int DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_now timestamptz := now(); v_row record; v_allow boolean := true;
BEGIN
  SELECT * INTO v_row FROM public.security_rate_limits WHERE bucket_key = p_bucket_key;

  IF v_row.bucket_key IS NULL THEN
    INSERT INTO public.security_rate_limits(bucket_key, window_start, window_seconds, count)
    VALUES (p_bucket_key, v_now, p_window_seconds, 1);
    RETURN jsonb_build_object('allow', true, 'count', 1, 'blocked_until', null);
  END IF;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN jsonb_build_object('allow', false, 'count', v_row.count, 'blocked_until', v_row.blocked_until);
  END IF;

  IF v_row.window_start + make_interval(secs => v_row.window_seconds) < v_now THEN
    UPDATE public.security_rate_limits SET window_start = v_now, window_seconds = p_window_seconds, count = 1, blocked_until = null, updated_at = v_now WHERE bucket_key = p_bucket_key;
    RETURN jsonb_build_object('allow', true, 'count', 1, 'blocked_until', null);
  END IF;

  UPDATE public.security_rate_limits SET count = count + 1, updated_at = v_now WHERE bucket_key = p_bucket_key RETURNING * INTO v_row;

  IF v_row.count > p_max_count THEN
    UPDATE public.security_rate_limits SET blocked_until = v_now + make_interval(secs => p_block_seconds), updated_at = v_now WHERE bucket_key = p_bucket_key RETURNING blocked_until INTO v_row.blocked_until;
    v_allow := false;
  END IF;

  RETURN jsonb_build_object('allow', v_allow, 'count', v_row.count, 'blocked_until', v_row.blocked_until);
END $$;

CREATE OR REPLACE FUNCTION public.note_code_failure(p_code text, p_max_fail int DEFAULT 5, p_lock_seconds int DEFAULT 1800)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_now timestamptz := now(); v_row record;
BEGIN
  SELECT * INTO v_row FROM public.license_code_lockouts WHERE license_code = p_code;

  IF v_row.license_code IS NULL THEN
    INSERT INTO public.license_code_lockouts(license_code, failed_attempts, locked_until, last_attempt_at) VALUES (p_code, 1, null, v_now);
  ELSE
    UPDATE public.license_code_lockouts SET failed_attempts = failed_attempts + 1, last_attempt_at = v_now, updated_at = v_now WHERE license_code = p_code;
  END IF;

  SELECT * INTO v_row FROM public.license_code_lockouts WHERE license_code = p_code;

  IF v_row.failed_attempts >= p_max_fail THEN
    UPDATE public.license_code_lockouts SET locked_until = v_now + make_interval(secs => p_lock_seconds), updated_at = v_now WHERE license_code = p_code RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('failed_attempts', v_row.failed_attempts, 'locked_until', v_row.locked_until);
END $$;

CREATE OR REPLACE FUNCTION public.is_code_locked(p_code text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('locked', COALESCE(locked_until > now(), false), 'locked_until', locked_until, 'failed_attempts', failed_attempts)
     FROM public.license_code_lockouts WHERE license_code = p_code),
    jsonb_build_object('locked', false, 'locked_until', null, 'failed_attempts', 0)
  );
$$;

-- table_exists helper
CREATE OR REPLACE FUNCTION public.table_exists(p_table text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = p_table);
$$;
