
-- 1) Stabilize get_idempotency_response: always return {hit, response}
CREATE OR REPLACE FUNCTION public.get_idempotency_response(
  p_user_id uuid,
  p_endpoint text,
  p_idem_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resp jsonb;
BEGIN
  SELECT response_json INTO v_resp
  FROM public.idempotency_keys
  WHERE user_id = p_user_id
    AND endpoint = p_endpoint
    AND idempotency_key = p_idem_key
  LIMIT 1;

  IF v_resp IS NULL THEN
    RETURN jsonb_build_object('hit', false, 'response', NULL);
  END IF;

  RETURN jsonb_build_object('hit', true, 'response', v_resp);
END;
$$;

REVOKE ALL ON FUNCTION public.get_idempotency_response(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_idempotency_response(uuid,text,text) TO service_role;

-- 2) Harden check_rate_limit_oral with input validation
CREATE OR REPLACE FUNCTION public.check_rate_limit_oral(
  p_user_id uuid,
  p_action_key text,
  p_window_seconds int,
  p_max_requests int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket timestamptz;
  v_count int;
BEGIN
  -- Input validation
  IF p_window_seconds <= 0 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'p_window_seconds must be between 1 and 86400';
  END IF;
  IF p_max_requests <= 0 OR p_max_requests > 10000 THEN
    RAISE EXCEPTION 'p_max_requests must be between 1 and 10000';
  END IF;
  IF length(p_action_key) > 100 THEN
    RAISE EXCEPTION 'p_action_key too long';
  END IF;

  v_bucket := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.api_rate_limits (user_id, action_key, window_start, request_count, updated_at)
  VALUES (p_user_id, p_action_key, v_bucket, 1, now())
  ON CONFLICT (user_id, action_key, window_start)
  DO UPDATE SET request_count = public.api_rate_limits.request_count + 1,
                updated_at = now()
  RETURNING request_count INTO v_count;

  IF v_count > p_max_requests THEN
    RETURN jsonb_build_object(
      'ok', false,
      'retry_after_sec', p_window_seconds - extract(epoch FROM (now() - v_bucket))::int,
      'current_count', v_count,
      'limit', p_max_requests
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'current_count', v_count, 'limit', p_max_requests);
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit_oral(uuid,text,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_oral(uuid,text,int,int) TO service_role;
