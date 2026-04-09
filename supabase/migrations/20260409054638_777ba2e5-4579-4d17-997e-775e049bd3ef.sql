
-- =====================================================
-- BULK IMPORT ENGINE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.bulk_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  file_name text,
  file_type text NOT NULL DEFAULT 'users',
  raw_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_result jsonb DEFAULT '{}'::jsonb,
  dry_run_result jsonb DEFAULT '{}'::jsonb,
  execution_result jsonb DEFAULT '{}'::jsonb,
  total_rows integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.bulk_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage bulk imports"
ON public.bulk_import_jobs
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
);

CREATE INDEX idx_bulk_import_jobs_user ON public.bulk_import_jobs(user_id, created_at DESC);
CREATE INDEX idx_bulk_import_jobs_status ON public.bulk_import_jobs(status);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at_bulk_import_jobs()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_set_updated_at_bulk_import_jobs
BEFORE UPDATE ON public.bulk_import_jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at_bulk_import_jobs();

-- =====================================================
-- SCIM TOKENS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.scim_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'SCIM Token',
  org_id uuid REFERENCES public.organizations(id),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz
);

ALTER TABLE public.scim_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage SCIM tokens"
ON public.scim_tokens
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =====================================================
-- VALIDATE BULK IMPORT RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.fn_validate_bulk_import(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_row jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_valid_count integer := 0;
  v_idx integer := 0;
  v_email text;
  v_ext_id text;
  v_seen_emails text[] := '{}';
  v_seen_ext_ids text[] := '{}';
BEGIN
  SELECT * INTO v_job FROM public.bulk_import_jobs WHERE id = p_job_id;
  IF v_job IS NULL THEN
    RETURN jsonb_build_object('error', 'Job not found');
  END IF;

  UPDATE public.bulk_import_jobs SET status = 'validating' WHERE id = p_job_id;

  FOR v_row IN SELECT jsonb_array_elements(v_job.raw_data)
  LOOP
    v_idx := v_idx + 1;
    v_email := lower(trim(v_row->>'email'));
    v_ext_id := trim(v_row->>'external_id');

    -- Required fields
    IF v_email IS NULL OR v_email = '' THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'email', 'message', 'E-Mail fehlt');
      CONTINUE;
    END IF;

    IF v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'email', 'message', 'Ungültige E-Mail');
      CONTINUE;
    END IF;

    IF v_ext_id IS NULL OR v_ext_id = '' THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'external_id', 'message', 'external_id fehlt');
      CONTINUE;
    END IF;

    -- Duplicate checks within file
    IF v_email = ANY(v_seen_emails) THEN
      v_warnings := v_warnings || jsonb_build_object('row', v_idx, 'field', 'email', 'message', 'Doppelte E-Mail in Datei');
    END IF;
    v_seen_emails := array_append(v_seen_emails, v_email);

    IF v_ext_id = ANY(v_seen_ext_ids) THEN
      v_warnings := v_warnings || jsonb_build_object('row', v_idx, 'field', 'external_id', 'message', 'Doppelte external_id in Datei');
    END IF;
    v_seen_ext_ids := array_append(v_seen_ext_ids, v_ext_id);

    v_valid_count := v_valid_count + 1;
  END LOOP;

  UPDATE public.bulk_import_jobs
  SET status = 'validated',
      total_rows = v_idx,
      valid_count = v_valid_count,
      error_count = jsonb_array_length(v_errors),
      warning_count = jsonb_array_length(v_warnings),
      validation_result = jsonb_build_object(
        'errors', v_errors,
        'warnings', v_warnings,
        'valid_count', v_valid_count,
        'total_rows', v_idx
      )
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'valid_count', v_valid_count,
    'total_rows', v_idx,
    'error_count', jsonb_array_length(v_errors),
    'warning_count', jsonb_array_length(v_warnings),
    'errors', v_errors,
    'warnings', v_warnings
  );
END;
$$;

-- =====================================================
-- DRY RUN BULK IMPORT RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.fn_dry_run_bulk_import(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_row jsonb;
  v_preview jsonb := '[]'::jsonb;
  v_to_create integer := 0;
  v_to_update integer := 0;
  v_email text;
  v_ext_id text;
  v_existing_id uuid;
BEGIN
  SELECT * INTO v_job FROM public.bulk_import_jobs WHERE id = p_job_id;
  IF v_job IS NULL THEN
    RETURN jsonb_build_object('error', 'Job not found');
  END IF;

  UPDATE public.bulk_import_jobs SET status = 'dry_run' WHERE id = p_job_id;

  FOR v_row IN SELECT jsonb_array_elements(v_job.raw_data)
  LOOP
    v_email := lower(trim(v_row->>'email'));
    v_ext_id := trim(v_row->>'external_id');

    IF v_email IS NULL OR v_email = '' OR v_ext_id IS NULL OR v_ext_id = '' THEN
      CONTINUE;
    END IF;

    -- Check if learner identity with this external_id exists
    SELECT li.id INTO v_existing_id
    FROM public.learner_identities li
    WHERE li.external_subject_hash = encode(digest(v_ext_id, 'sha256'), 'hex')
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      v_to_update := v_to_update + 1;
      v_preview := v_preview || jsonb_build_object(
        'email', v_email,
        'external_id', v_ext_id,
        'action', 'update',
        'existing_identity_id', v_existing_id
      );
    ELSE
      v_to_create := v_to_create + 1;
      v_preview := v_preview || jsonb_build_object(
        'email', v_email,
        'external_id', v_ext_id,
        'action', 'create'
      );
    END IF;
  END LOOP;

  UPDATE public.bulk_import_jobs
  SET dry_run_result = jsonb_build_object(
    'to_create', v_to_create,
    'to_update', v_to_update,
    'preview', v_preview
  )
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'to_create', v_to_create,
    'to_update', v_to_update,
    'preview', v_preview
  );
END;
$$;

-- =====================================================
-- EXECUTE BULK IMPORT RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.fn_execute_bulk_import(
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_row jsonb;
  v_created integer := 0;
  v_updated integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_email text;
  v_ext_id text;
  v_ext_hash text;
  v_existing_id uuid;
  v_org_id uuid;
  v_first_name text;
  v_last_name text;
BEGIN
  SELECT * INTO v_job FROM public.bulk_import_jobs WHERE id = p_job_id;
  IF v_job IS NULL THEN
    RETURN jsonb_build_object('error', 'Job not found');
  END IF;

  IF v_job.status NOT IN ('validated', 'dry_run') THEN
    RETURN jsonb_build_object('error', 'Job must be validated first');
  END IF;

  UPDATE public.bulk_import_jobs SET status = 'executing' WHERE id = p_job_id;

  FOR v_row IN SELECT jsonb_array_elements(v_job.raw_data)
  LOOP
    BEGIN
      v_email := lower(trim(v_row->>'email'));
      v_ext_id := trim(v_row->>'external_id');
      v_first_name := trim(COALESCE(v_row->>'first_name', ''));
      v_last_name := trim(COALESCE(v_row->>'last_name', ''));
      v_org_id := NULLIF(trim(COALESCE(v_row->>'org_id', '')), '')::uuid;

      IF v_email IS NULL OR v_email = '' OR v_ext_id IS NULL OR v_ext_id = '' THEN
        v_failed := v_failed + 1;
        CONTINUE;
      END IF;

      v_ext_hash := encode(digest(v_ext_id, 'sha256'), 'hex');

      -- Upsert learner identity
      SELECT id INTO v_existing_id
      FROM public.learner_identities
      WHERE external_subject_hash = v_ext_hash
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        UPDATE public.learner_identities
        SET display_name = CASE WHEN v_first_name != '' THEN v_first_name || ' ' || v_last_name ELSE display_name END,
            org_id = COALESCE(v_org_id, org_id),
            updated_at = now()
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO public.learner_identities (
          identity_type, external_subject_hash, display_name, org_id
        ) VALUES (
          'csv_import', v_ext_hash,
          CASE WHEN v_first_name != '' THEN v_first_name || ' ' || v_last_name ELSE v_email END,
          v_org_id
        )
        RETURNING id INTO v_existing_id;
        v_created := v_created + 1;
      END IF;

      -- Org membership if org_id provided
      IF v_org_id IS NOT NULL THEN
        INSERT INTO public.org_memberships (org_id, user_id, role, status)
        SELECT v_org_id, li.user_id, COALESCE(v_row->>'role', 'learner'), 'active'
        FROM public.learner_identities li
        WHERE li.id = v_existing_id AND li.user_id IS NOT NULL
        ON CONFLICT DO NOTHING;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'email', v_email,
        'error', SQLERRM
      );
    END;
  END LOOP;

  UPDATE public.bulk_import_jobs
  SET status = 'completed',
      created_count = v_created,
      updated_count = v_updated,
      failed_count = v_failed,
      completed_at = now(),
      execution_result = jsonb_build_object(
        'created', v_created,
        'updated', v_updated,
        'failed', v_failed,
        'errors', v_errors
      )
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$$;

-- Revoke public access
REVOKE EXECUTE ON FUNCTION public.fn_validate_bulk_import FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_dry_run_bulk_import FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_execute_bulk_import FROM PUBLIC;
