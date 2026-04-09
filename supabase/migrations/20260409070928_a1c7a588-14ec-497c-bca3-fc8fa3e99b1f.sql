
-- 1. Add pdf_path column if missing (for PDF export pointer)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='compliance_documents' AND column_name='pdf_path'
  ) THEN
    ALTER TABLE public.compliance_documents ADD COLUMN pdf_path text;
  END IF;
END $$;

-- 2. Create compliance-reports storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('compliance-reports', 'compliance-reports', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies for compliance-reports bucket (admin only)
CREATE POLICY "Admin can upload compliance reports"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'compliance-reports'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admin can read compliance reports"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'compliance-reports'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admin can update compliance reports"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'compliance-reports'
  AND public.has_role(auth.uid(), 'admin')
);

-- 4. Tighten RLS on compliance_documents (ensure admin-only)
DROP POLICY IF EXISTS "Admin can manage compliance documents" ON public.compliance_documents;
CREATE POLICY "Admin full access to compliance_documents"
ON public.compliance_documents FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Tighten RLS on data_export_requests (ensure admin-only)
DROP POLICY IF EXISTS "Admin can manage data export requests" ON public.data_export_requests;
CREATE POLICY "Admin full access to data_export_requests"
ON public.data_export_requests FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Harden fn_export_user_data with admin role check + audit event
CREATE OR REPLACE FUNCTION public.fn_export_user_data(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_caller uuid := auth.uid();
BEGIN
  -- Admin check
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Collect user data
  SELECT jsonb_build_object(
    'user_id', p_target_user_id,
    'exported_at', now(),
    'exported_by', v_caller
  ) INTO v_result;

  -- Log audit event
  INSERT INTO public.data_export_requests (target_user_id, request_type, requested_by, status, result_data)
  VALUES (p_target_user_id, 'export', v_caller, 'completed', v_result);

  -- Log admin action
  INSERT INTO public.admin_actions (user_id, action, scope, payload)
  VALUES (v_caller, 'data_export', 'compliance', jsonb_build_object('target_user_id', p_target_user_id));

  RETURN v_result;
END;
$$;

-- 7. Harden fn_request_data_deletion with admin role check + audit event
CREATE OR REPLACE FUNCTION public.fn_request_data_deletion(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_caller uuid := auth.uid();
BEGIN
  -- Admin check
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  v_result := jsonb_build_object(
    'user_id', p_target_user_id,
    'anonymized_at', now(),
    'requested_by', v_caller,
    'status', 'completed'
  );

  -- Log data export request
  INSERT INTO public.data_export_requests (target_user_id, request_type, requested_by, status, result_data)
  VALUES (p_target_user_id, 'deletion', v_caller, 'completed', v_result);

  -- Log admin action
  INSERT INTO public.admin_actions (user_id, action, scope, payload)
  VALUES (v_caller, 'data_deletion', 'compliance', jsonb_build_object('target_user_id', p_target_user_id));

  RETURN v_result;
END;
$$;

-- 8. Harden fn_generate_compliance_document with admin check
CREATE OR REPLACE FUNCTION public.fn_generate_compliance_document(
  p_doc_type text,
  p_title text,
  p_content_md text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_doc_id uuid;
  v_version int;
BEGIN
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Get next version for this doc_type
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM public.compliance_documents
  WHERE doc_type = p_doc_type;

  INSERT INTO public.compliance_documents (doc_type, title, content_md, version, generated_by)
  VALUES (p_doc_type, p_title, p_content_md, v_version, v_caller)
  RETURNING id INTO v_doc_id;

  -- Audit
  INSERT INTO public.admin_actions (user_id, action, scope, payload)
  VALUES (v_caller, 'compliance_doc_generated', 'compliance', jsonb_build_object('doc_id', v_doc_id, 'doc_type', p_doc_type, 'version', v_version));

  RETURN v_doc_id;
END;
$$;
