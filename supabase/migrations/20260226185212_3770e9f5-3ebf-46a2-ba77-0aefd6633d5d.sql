
-- Drop old function signatures to resolve ambiguity
DROP FUNCTION IF EXISTS public.set_idempotency_response(UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.cleanup_oral_exam_ephemeral();

-- Recreate with correct column name
CREATE OR REPLACE FUNCTION public.set_idempotency_response(
  p_user_id UUID,
  p_endpoint TEXT,
  p_key TEXT,
  p_response JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO idempotency_keys (user_id, endpoint, idem_key, response_json)
  VALUES (p_user_id, p_endpoint, p_key, p_response)
  ON CONFLICT (user_id, endpoint, idem_key)
  DO UPDATE SET response_json = p_response;
END;
$$;

REVOKE ALL ON FUNCTION public.set_idempotency_response(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_idempotency_response(UUID, TEXT, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_oral_exam_ephemeral()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
  DELETE FROM api_rate_limits WHERE window_start < now() - interval '2 hours';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_oral_exam_ephemeral() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_oral_exam_ephemeral() TO service_role;
