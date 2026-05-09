
-- Admin-gated RPC: list recent gate export jobs (own + global view for admins)
CREATE OR REPLACE FUNCTION public.admin_get_gate_export_jobs(p_limit int DEFAULT 10)
RETURNS TABLE(
  id uuid,
  package_id uuid,
  window_days int,
  lane text,
  decision text,
  format text,
  status text,
  total_rows int,
  file_paths jsonb,
  error text,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  requested_by uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.package_id, j.window_days, j.lane, j.decision, j.format,
         j.status, j.total_rows, j.file_paths, j.error,
         j.created_at, j.started_at, j.completed_at, j.requested_by
  FROM public.gate_export_jobs j
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY j.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 10), 100));
$$;

REVOKE ALL ON FUNCTION public.admin_get_gate_export_jobs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_gate_export_jobs(int) TO authenticated, service_role;

-- Realtime: enable publication for gate_export_jobs (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'gate_export_jobs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.gate_export_jobs';
  END IF;
END $$;

-- REPLICA IDENTITY FULL für vollständige Realtime-Payload
ALTER TABLE public.gate_export_jobs REPLICA IDENTITY FULL;
