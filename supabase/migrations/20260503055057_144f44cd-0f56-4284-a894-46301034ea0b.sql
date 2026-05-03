-- Admin RPC: list force-publish events from auto_heal_log
CREATE OR REPLACE FUNCTION public.admin_get_force_publish_log(
  p_limit int DEFAULT 100,
  p_since timestamptz DEFAULT now() - interval '30 days',
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  package_id uuid,
  package_title text,
  reason text,
  previous_status text,
  build_progress numeric,
  cancelled_jobs int,
  admin_user uuid,
  admin_email text,
  result_detail text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.created_at,
    NULLIF(l.metadata->>'package_id','')::uuid           AS package_id,
    cp.title                                              AS package_title,
    l.metadata->>'reason'                                 AS reason,
    l.metadata->>'previous_status'                        AS previous_status,
    NULLIF(l.metadata->>'build_progress','')::numeric     AS build_progress,
    NULLIF(l.metadata->>'cancelled_jobs','')::int         AS cancelled_jobs,
    NULLIF(l.metadata->>'admin_user','')::uuid            AS admin_user,
    u.email                                               AS admin_email,
    l.result_detail
  FROM public.auto_heal_log l
  LEFT JOIN public.course_packages cp ON cp.id = NULLIF(l.metadata->>'package_id','')::uuid
  LEFT JOIN auth.users u ON u.id = NULLIF(l.metadata->>'admin_user','')::uuid
  WHERE l.action_type = 'admin_force_publish'
    AND l.created_at >= p_since
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (
      p_search IS NULL OR p_search = ''
      OR cp.title ILIKE '%'||p_search||'%'
      OR l.metadata->>'reason' ILIKE '%'||p_search||'%'
      OR u.email ILIKE '%'||p_search||'%'
      OR (l.metadata->>'package_id') ILIKE '%'||p_search||'%'
    )
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

REVOKE ALL ON FUNCTION public.admin_get_force_publish_log(int, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_force_publish_log(int, timestamptz, text) TO authenticated;

COMMENT ON FUNCTION public.admin_get_force_publish_log(int, timestamptz, text) IS
'Admin-only audit feed of admin_force_publish events. SECURITY DEFINER + has_role gate.';