
-- 1. Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('gate-exports', 'gate-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Only service_role writes; admins read via signed URLs (no direct policy needed)
DROP POLICY IF EXISTS "gate-exports admin read" ON storage.objects;
CREATE POLICY "gate-exports admin read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'gate-exports' AND has_role(auth.uid(), 'admin'::app_role));

-- 2. Job tracking table
CREATE TABLE IF NOT EXISTS public.gate_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL,
  package_id uuid NOT NULL,
  window_days integer NOT NULL DEFAULT 30,
  lane text,
  decision text,
  format text NOT NULL CHECK (format IN ('csv','json')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed')),
  file_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_rows integer,
  error text,
  intent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_gate_export_jobs_requester
  ON public.gate_export_jobs (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_export_jobs_status
  ON public.gate_export_jobs (status, created_at DESC);

ALTER TABLE public.gate_export_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gate_export_jobs_admin_read ON public.gate_export_jobs;
CREATE POLICY gate_export_jobs_admin_read
  ON public.gate_export_jobs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. RPC: request a new export (creates job + system_intent)
CREATE OR REPLACE FUNCTION public.admin_request_gate_export(
  p_package_id uuid,
  p_window_days integer DEFAULT 30,
  p_lane text DEFAULT NULL,
  p_decision text DEFAULT NULL,
  p_format text DEFAULT 'csv'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_intent_id uuid;
  v_signature text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_format NOT IN ('csv','json') THEN
    RAISE EXCEPTION 'invalid format: %', p_format;
  END IF;

  v_job_id := gen_random_uuid();

  INSERT INTO public.gate_export_jobs
    (id, requested_by, package_id, window_days, lane, decision, format, status)
  VALUES
    (v_job_id, auth.uid(), p_package_id,
     GREATEST(COALESCE(p_window_days, 30), 1),
     NULLIF(p_lane,''), NULLIF(p_decision,''), p_format, 'queued');

  v_signature := 'gate_history_export:' || v_job_id::text;

  INSERT INTO public.system_intents
    (intent_type, package_id, priority, payload, signature, source)
  VALUES
    ('gate_history_export', p_package_id, 50,
     jsonb_build_object('job_id', v_job_id),
     v_signature, 'admin_request_gate_export')
  RETURNING id INTO v_intent_id;

  UPDATE public.gate_export_jobs
     SET intent_id = v_intent_id
   WHERE id = v_job_id;

  RETURN v_job_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_request_gate_export(uuid,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_request_gate_export(uuid,integer,text,text,text)
  TO authenticated;

-- 4. RPC: poll job status; mints signed URLs for each part on completion
CREATE OR REPLACE FUNCTION public.admin_get_gate_export_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_job public.gate_export_jobs%ROWTYPE;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT * INTO v_job FROM public.gate_export_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  v := jsonb_build_object(
    'id', v_job.id,
    'status', v_job.status,
    'format', v_job.format,
    'package_id', v_job.package_id,
    'window_days', v_job.window_days,
    'lane', v_job.lane,
    'decision', v_job.decision,
    'total_rows', v_job.total_rows,
    'file_paths', v_job.file_paths,
    'error', v_job.error,
    'created_at', v_job.created_at,
    'started_at', v_job.started_at,
    'completed_at', v_job.completed_at
  );
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_gate_export_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_gate_export_job(uuid)
  TO authenticated;
