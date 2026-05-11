-- SEO Rollback Toggle RPCs (admin-gated, audited)

-- 1) Toggle flag with audit
CREATE OR REPLACE FUNCTION public.admin_set_seo_feature_flag(
  p_flag_key text,
  p_enabled boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev boolean;
  v_existed boolean;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_flag_key IS NULL OR p_flag_key NOT LIKE 'seo_%' THEN
    RAISE EXCEPTION 'flag_key must start with seo_';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (min 5 chars)';
  END IF;

  SELECT enabled, true INTO v_prev, v_existed
    FROM public.ops_feature_flags WHERE flag_key = p_flag_key;

  IF NOT COALESCE(v_existed, false) THEN
    INSERT INTO public.ops_feature_flags(flag_key, enabled, notes, updated_at, updated_by)
    VALUES (p_flag_key, p_enabled, 'Created via admin_set_seo_feature_flag: ' || p_reason, now(), v_uid);
  ELSE
    UPDATE public.ops_feature_flags
       SET enabled = p_enabled,
           notes = 'Toggled via admin_set_seo_feature_flag: ' || p_reason,
           updated_at = now(),
           updated_by = v_uid
     WHERE flag_key = p_flag_key;
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_uid)
  VALUES (
    'seo_feature_flag_toggle',
    'feature_flag',
    p_flag_key,
    'success',
    jsonb_build_object(
      'flag_key', p_flag_key,
      'previous', v_prev,
      'new', p_enabled,
      'reason', p_reason,
      'actor', v_uid
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'flag_key', p_flag_key,
    'previous', v_prev,
    'new', p_enabled,
    'changed', (v_prev IS DISTINCT FROM p_enabled),
    'actor', v_uid,
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_seo_feature_flag(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_seo_feature_flag(text, boolean, text) TO authenticated;

-- 2) Recent integrity gate failures (context for rollback dialog)
CREATE OR REPLACE FUNCTION public.admin_get_recent_integrity_gate_failures(
  p_limit int DEFAULT 10,
  p_window_minutes int DEFAULT 60
) RETURNS TABLE(
  job_id uuid,
  package_id uuid,
  status text,
  last_error_code text,
  last_error text,
  integrity_passed boolean,
  score numeric,
  hard_fail_count int,
  created_at timestamptz,
  age_seconds int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    jq.id,
    (jq.payload->>'package_id')::uuid,
    jq.status::text,
    jq.last_error_code::text,
    jq.last_error::text,
    NULLIF(jq.meta->'last_result'->>'integrity_passed','')::boolean,
    NULLIF(jq.meta->'last_result'->>'score','')::numeric,
    NULLIF(jq.meta->'last_result'->>'hard_fail_count','')::int,
    jq.created_at,
    EXTRACT(EPOCH FROM (now() - jq.created_at))::int
  FROM public.job_queue jq
  WHERE jq.job_type = 'package_run_integrity_check'
    AND jq.created_at > now() - make_interval(mins => p_window_minutes)
    AND (
      jq.last_error = 'QUALITY_THRESHOLD_NOT_MET'
      OR jq.last_error_code = 'QUALITY_THRESHOLD_NOT_MET'
      OR (jq.meta->'last_result'->>'integrity_passed') = 'false'
    )
  ORDER BY jq.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_recent_integrity_gate_failures(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_recent_integrity_gate_failures(int, int) TO authenticated;