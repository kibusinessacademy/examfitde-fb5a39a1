
-- org_import_jobs
CREATE TABLE public.org_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  file_name text,
  dry_run boolean NOT NULL DEFAULT false,
  total_rows int NOT NULL DEFAULT 0,
  processed_rows int NOT NULL DEFAULT 0,
  success_rows int NOT NULL DEFAULT 0,
  failed_rows int NOT NULL DEFAULT 0,
  created_count int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  assigned_seats int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  error_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_org_import_jobs_org ON public.org_import_jobs(org_id);

ALTER TABLE public.org_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_import_jobs_select" ON public.org_import_jobs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = org_import_jobs.org_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','IT_ADMIN')
      AND om.status = 'active'
  ));

CREATE POLICY "org_import_jobs_insert" ON public.org_import_jobs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = org_import_jobs.org_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','IT_ADMIN')
      AND om.status = 'active'
  ));

CREATE POLICY "org_import_jobs_update" ON public.org_import_jobs FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = org_import_jobs.org_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','IT_ADMIN')
      AND om.status = 'active'
  ));

-- org_import_job_rows
CREATE TABLE public.org_import_job_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.org_import_jobs(id) ON DELETE CASCADE,
  row_number int NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  user_id uuid,
  learner_identity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_import_rows_job ON public.org_import_job_rows(job_id);

ALTER TABLE public.org_import_job_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_import_rows_select" ON public.org_import_job_rows FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.org_import_jobs j
    JOIN public.org_memberships om ON om.org_id = j.org_id
    WHERE j.id = org_import_job_rows.job_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','IT_ADMIN')
      AND om.status = 'active'
  ));

-- Enhance sso_connections with test status fields
ALTER TABLE public.sso_connections ADD COLUMN IF NOT EXISTS last_test_status text;
ALTER TABLE public.sso_connections ADD COLUMN IF NOT EXISTS last_error text;
