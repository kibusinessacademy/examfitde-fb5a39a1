
-- Idempotent security hardening (handles pre-existing objects)

-- 1) rate_limits
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  request_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON public.rate_limits(window_start);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
DROP POLICY IF EXISTS "deny_all_rate_limits" ON public.rate_limits;
CREATE POLICY "deny_all_rate_limits" ON public.rate_limits FOR ALL USING (false) WITH CHECK (false);

-- 2) idempotency_keys (user_id scoped PK)
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  idempotency_key text NOT NULL,
  endpoint text NOT NULL,
  user_id uuid NOT NULL,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idempotency_key, endpoint, user_id)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx ON public.idempotency_keys(created_at);
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.idempotency_keys FROM anon, authenticated;
DROP POLICY IF EXISTS "deny_all_idempotency" ON public.idempotency_keys;
CREATE POLICY "deny_all_idempotency" ON public.idempotency_keys FOR ALL USING (false) WITH CHECK (false);

-- 3) security_events (may already exist)
CREATE TABLE IF NOT EXISTS public.security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  user_id uuid,
  endpoint text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON public.security_events(created_at);
CREATE INDEX IF NOT EXISTS security_events_type_idx ON public.security_events(event_type);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM anon, authenticated;
DROP POLICY IF EXISTS "deny_all_security_events" ON public.security_events;
CREATE POLICY "deny_all_security_events" ON public.security_events FOR ALL USING (false) WITH CHECK (false);

-- ═══ RPCs ═══

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_key text, p_window_seconds int, p_max_requests int
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count int;
BEGIN
  v_window_start := v_now - make_interval(secs => p_window_seconds);
  INSERT INTO rate_limits (user_key, window_start, request_count, updated_at)
  VALUES (p_user_key, v_now, 1, v_now)
  ON CONFLICT (user_key) DO UPDATE SET
    request_count = CASE WHEN rate_limits.window_start < v_window_start THEN 1 ELSE rate_limits.request_count + 1 END,
    window_start = CASE WHEN rate_limits.window_start < v_window_start THEN v_now ELSE rate_limits.window_start END,
    updated_at = v_now
  RETURNING request_count INTO v_count;
  RETURN v_count <= p_max_requests;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text,int,int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text,int,int) TO service_role;

CREATE OR REPLACE FUNCTION public.use_idempotency_key(
  p_key text, p_user_id uuid, p_endpoint text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing jsonb;
BEGIN
  SELECT response_json INTO v_existing FROM idempotency_keys
  WHERE idempotency_key = p_key AND endpoint = p_endpoint AND user_id = p_user_id;
  IF found AND v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  INSERT INTO idempotency_keys (idempotency_key, endpoint, user_id)
  VALUES (p_key, p_endpoint, p_user_id)
  ON CONFLICT (idempotency_key, endpoint, user_id) DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_idempotency_response(
  p_key text, p_endpoint text, p_response jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE idempotency_keys SET response_json = p_response
  WHERE idempotency_key = p_key AND endpoint = p_endpoint;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.use_idempotency_key(text,uuid,text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_idempotency_response(text,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_idempotency_key(text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_idempotency_response(text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type text, p_user_id uuid DEFAULT NULL, p_endpoint text DEFAULT NULL, p_metadata jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO security_events (event_type, user_id, endpoint, metadata) VALUES (p_event_type, p_user_id, p_endpoint, p_metadata);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_security_event(text,uuid,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_event(text,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_security_tables() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < now() - interval '2 hours';
  DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
  DELETE FROM security_events WHERE created_at < now() - interval '90 days';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_security_tables() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_security_tables() TO service_role;

CREATE OR REPLACE FUNCTION public.check_publish_integrity()
RETURNS TABLE(package_id uuid, curriculum_id uuid, approved_q bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT cp.id, cp.curriculum_id,
    (SELECT count(*) FROM exam_questions q WHERE q.curriculum_id = cp.curriculum_id AND q.status = 'approved')
  FROM course_packages cp
  WHERE cp.status = 'published'
    AND (cp.curriculum_id IS NULL
      OR (SELECT count(*) FROM exam_questions q WHERE q.curriculum_id = cp.curriculum_id AND q.status = 'approved') = 0);
$$;
REVOKE EXECUTE ON FUNCTION public.check_publish_integrity() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_publish_integrity() TO service_role;
