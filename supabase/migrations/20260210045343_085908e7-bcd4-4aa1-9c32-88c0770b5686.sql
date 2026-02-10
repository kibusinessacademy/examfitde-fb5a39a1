
-- ============================================
-- Export Jobs table for admin course exports
-- ============================================
CREATE TABLE IF NOT EXISTS public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  formats text[] NOT NULL DEFAULT ARRAY['json','xlsx','tsx'],
  output_path text NULL,
  file_size_bytes bigint NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "export_jobs_admin_select"
ON public.export_jobs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "export_jobs_admin_insert"
ON public.export_jobs FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "export_jobs_admin_update"
ON public.export_jobs FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_export_jobs_updated_at
BEFORE UPDATE ON public.export_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Status constraint via trigger (not CHECK for flexibility)
CREATE OR REPLACE FUNCTION public.validate_export_job_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('queued', 'running', 'done', 'failed') THEN
    RAISE EXCEPTION 'Invalid export job status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_export_job_status_trigger
BEFORE INSERT OR UPDATE ON public.export_jobs
FOR EACH ROW
EXECUTE FUNCTION public.validate_export_job_status();

-- Storage bucket for exports (private, admin-only)
INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: admin-only access
CREATE POLICY "exports_admin_select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'exports' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "exports_admin_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'exports' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "exports_admin_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'exports' AND public.has_role(auth.uid(), 'admin'));
