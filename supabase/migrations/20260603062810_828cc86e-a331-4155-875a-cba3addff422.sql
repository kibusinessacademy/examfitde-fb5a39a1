-- =====================================================
-- P1: SAFE CAST HELPERS (row-tolerant importer foundation)
-- =====================================================

CREATE OR REPLACE FUNCTION public.safe_int(p_text text)
RETURNS bigint
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v_out bigint;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN NULL; END IF;
  BEGIN
    v_out := btrim(p_text)::bigint;
    RETURN v_out;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_numeric(p_text text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v_out numeric;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN NULL; END IF;
  BEGIN
    -- accept comma decimals as well
    v_out := replace(btrim(p_text), ',', '.')::numeric;
    RETURN v_out;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_date(p_text text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v_out date;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN NULL; END IF;
  BEGIN
    v_out := btrim(p_text)::date;
    RETURN v_out;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_timestamptz(p_text text)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v_out timestamptz;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN NULL; END IF;
  BEGIN
    v_out := btrim(p_text)::timestamptz;
    RETURN v_out;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_uuid(p_text text)
RETURNS uuid
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v_out uuid;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN NULL; END IF;
  BEGIN
    v_out := btrim(p_text)::uuid;
    RETURN v_out;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.safe_int(text)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.safe_numeric(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.safe_date(text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.safe_timestamptz(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.safe_uuid(text)        TO authenticated, service_role;

-- =====================================================
-- P1: Extend bulk_import_jobs with row-level reject tracking
-- =====================================================

ALTER TABLE public.bulk_import_jobs
  ADD COLUMN IF NOT EXISTS rejected_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_rows jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =====================================================
-- P1: Row-tolerant fn_execute_bulk_import
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
  v_job          record;
  v_row          jsonb;
  v_idx          integer := 0;
  v_created      integer := 0;
  v_updated      integer := 0;
  v_rejected     integer := 0;
  v_failed       integer := 0;
  v_errors       jsonb := '[]'::jsonb;
  v_rejected_rows jsonb := '[]'::jsonb;

  v_email        text;
  v_ext_id       text;
  v_first_name   text;
  v_last_name    text;
  v_org_id_text  text;
  v_org_id       uuid;
  v_ext_hash     text;
  v_existing_id  uuid;
  v_row_reasons  jsonb;
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
    v_idx := v_idx + 1;
    v_row_reasons := '[]'::jsonb;

    -- ---- Row-level safe parse (no direct casts on raw JSON) ----
    v_email      := lower(btrim(COALESCE(v_row->>'email', '')));
    v_ext_id     := btrim(COALESCE(v_row->>'external_id', ''));
    v_first_name := btrim(COALESCE(v_row->>'first_name', ''));
    v_last_name  := btrim(COALESCE(v_row->>'last_name', ''));
    v_org_id_text := COALESCE(v_row->>'org_id', '');
    v_org_id     := public.safe_uuid(v_org_id_text);

    -- Per-field validation
    IF v_email = '' THEN
      v_row_reasons := v_row_reasons || jsonb_build_object('field','email','reason','missing_email');
    ELSIF v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
      v_row_reasons := v_row_reasons || jsonb_build_object('field','email','reason','invalid_email');
    END IF;

    IF v_ext_id = '' THEN
      v_row_reasons := v_row_reasons || jsonb_build_object('field','external_id','reason','missing_external_id');
    END IF;

    IF btrim(v_org_id_text) <> '' AND v_org_id IS NULL THEN
      v_row_reasons := v_row_reasons || jsonb_build_object('field','org_id','reason','invalid_uuid');
    END IF;

    IF jsonb_array_length(v_row_reasons) > 0 THEN
      v_rejected := v_rejected + 1;
      v_rejected_rows := v_rejected_rows || jsonb_build_object(
        'row', v_idx,
        'email', NULLIF(v_email,''),
        'external_id', NULLIF(v_ext_id,''),
        'reasons', v_row_reasons
      );
      CONTINUE;
    END IF;

    -- ---- Mutating block protected by its own EXCEPTION handler ----
    BEGIN
      v_ext_hash := encode(digest(v_ext_id, 'sha256'), 'hex');

      SELECT id INTO v_existing_id
      FROM public.learner_identities
      WHERE external_subject_hash = v_ext_hash
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        UPDATE public.learner_identities
        SET display_name = CASE WHEN v_first_name <> '' THEN btrim(v_first_name || ' ' || v_last_name) ELSE display_name END,
            org_id = COALESCE(v_org_id, org_id),
            updated_at = now()
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO public.learner_identities (
          identity_type, external_subject_hash, display_name, org_id
        ) VALUES (
          'csv_import', v_ext_hash,
          CASE WHEN v_first_name <> '' THEN btrim(v_first_name || ' ' || v_last_name) ELSE v_email END,
          v_org_id
        )
        RETURNING id INTO v_existing_id;
        v_created := v_created + 1;
      END IF;

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
        'row', v_idx,
        'email', v_email,
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END LOOP;

  UPDATE public.bulk_import_jobs
  SET status = 'completed',
      created_count = v_created,
      updated_count = v_updated,
      failed_count = v_failed,
      rejected_count = v_rejected,
      rejected_rows = v_rejected_rows,
      completed_at = now(),
      execution_result = jsonb_build_object(
        'created', v_created,
        'updated', v_updated,
        'failed', v_failed,
        'rejected', v_rejected,
        'errors', v_errors,
        'rejected_rows', v_rejected_rows
      )
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'failed', v_failed,
    'rejected', v_rejected,
    'errors', v_errors,
    'rejected_rows', v_rejected_rows
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_execute_bulk_import(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_execute_bulk_import(uuid) TO authenticated, service_role;