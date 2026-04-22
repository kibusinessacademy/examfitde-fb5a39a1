
DROP FUNCTION IF EXISTS public.admin_get_queue_validation_warnings(integer);

CREATE OR REPLACE FUNCTION public.admin_get_queue_validation_warnings(_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid, package_id uuid, title text, body text, severity text,
  job_type text, mode text, source_job_id uuid,
  created_at timestamp with time zone, is_read boolean, cluster text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    n.id,
    n.entity_id AS package_id,
    n.title,
    n.body,
    n.severity,
    n.metadata->>'job_type'  AS job_type,
    n.metadata->>'mode'      AS mode,
    NULLIF(n.metadata->>'source_job','')::uuid AS source_job_id,
    n.created_at,
    n.is_read,
    COALESCE(n.metadata->>'cluster', n.metadata->>'auto_heal_source') AS cluster
  FROM admin_notifications n
  WHERE n.category IN ('queue_validation','queue_terminal')
    AND public.is_admin_user(auth.uid())
  ORDER BY n.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 200));
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_queue_validation_warnings(integer) TO authenticated;
