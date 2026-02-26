
-- v1.1 Security Hardening: user-scoped idempotency + bucketed rate limit + optimized publish integrity

-- 1) set_idempotency_response: add user_id scoping
CREATE OR REPLACE FUNCTION public.set_idempotency_response(
  p_key text,
  p_user_id uuid,
  p_endpoint text,
  p_response jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE idempotency_keys
  SET response_json = p_response
  WHERE idempotency_key = p_key
    AND endpoint = p_endpoint
    AND user_id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_idempotency_response(text,uuid,text,jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_idempotency_response(text,uuid,text,jsonb)
  TO service_role;

-- Drop old 3-arg version if exists
DROP FUNCTION IF EXISTS public.set_idempotency_response(text,text,jsonb);

-- 2) check_rate_limit: bucketed window_start for deterministic limits
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_key text,
  p_window_seconds int,
  p_max_requests int
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count int;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1)
  );

  INSERT INTO rate_limits (user_key, window_start, request_count, updated_at)
  VALUES (p_user_key, v_window_start, 1, now())
  ON CONFLICT (user_key) DO UPDATE
  SET
    window_start = CASE
      WHEN rate_limits.window_start = v_window_start THEN rate_limits.window_start
      ELSE v_window_start
    END,
    request_count = CASE
      WHEN rate_limits.window_start = v_window_start THEN rate_limits.request_count + 1
      ELSE 1
    END,
    updated_at = now()
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_max_requests;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text,int,int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text,int,int) TO service_role;

-- 3) check_publish_integrity: single-pass with LATERAL join
CREATE OR REPLACE FUNCTION public.check_publish_integrity()
RETURNS TABLE(package_id uuid, curriculum_id uuid, approved_q bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    cp.id AS package_id,
    cp.curriculum_id,
    COALESCE(q.approved_q, 0) AS approved_q
  FROM course_packages cp
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS approved_q
    FROM exam_questions eq
    WHERE eq.curriculum_id = cp.curriculum_id
      AND eq.status = 'approved'
  ) q ON true
  WHERE cp.status = 'published'
    AND (cp.curriculum_id IS NULL OR COALESCE(q.approved_q, 0) = 0);
$$;

REVOKE EXECUTE ON FUNCTION public.check_publish_integrity() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_publish_integrity() TO service_role;
