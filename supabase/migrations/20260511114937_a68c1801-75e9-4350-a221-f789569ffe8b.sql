CREATE OR REPLACE FUNCTION public.admin_get_seo_feature_flag_toggle_log(
  p_flag_key text DEFAULT NULL,
  p_limit int DEFAULT 10
) RETURNS TABLE(
  log_id uuid,
  flag_key text,
  previous_enabled boolean,
  new_enabled boolean,
  reason text,
  actor_uid uuid,
  result_status text,
  created_at timestamptz
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
    l.id,
    COALESCE(l.metadata->>'flag_key', l.target_id)::text,
    NULLIF(l.metadata->>'previous','')::boolean,
    NULLIF(l.metadata->>'new','')::boolean,
    (l.metadata->>'reason')::text,
    l.actor_uid,
    l.result_status::text,
    l.created_at
  FROM public.auto_heal_log l
  WHERE l.action_type = 'seo_feature_flag_toggle'
    AND (p_flag_key IS NULL OR l.target_id = p_flag_key OR l.metadata->>'flag_key' = p_flag_key)
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_feature_flag_toggle_log(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_feature_flag_toggle_log(text, int) TO authenticated;