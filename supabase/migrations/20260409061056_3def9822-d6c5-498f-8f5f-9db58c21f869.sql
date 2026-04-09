
-- Compliance Documents table
CREATE TABLE IF NOT EXISTS public.compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL DEFAULT 'gdpr_report',
  title text NOT NULL,
  content_md text NOT NULL DEFAULT '',
  pdf_path text,
  generated_by uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage compliance_documents" ON public.compliance_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Data Export/Deletion Requests
CREATE TABLE IF NOT EXISTS public.data_export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  request_type text NOT NULL DEFAULT 'export',
  status text NOT NULL DEFAULT 'pending',
  result_json jsonb,
  requested_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_export_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage data_export_requests" ON public.data_export_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- AI Interaction Logs (EU AI Act transparency)
CREATE TABLE IF NOT EXISTS public.ai_interaction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid,
  competency_id uuid,
  lesson_id uuid,
  curriculum_id uuid,
  prompt_hash text,
  response_hash text,
  model_used text,
  source_type text NOT NULL DEFAULT 'curriculum_ssot',
  tokens_used integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_interaction_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own ai_interaction_logs" ON public.ai_interaction_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all ai_interaction_logs" ON public.ai_interaction_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "System can insert ai_interaction_logs" ON public.ai_interaction_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_interaction_logs_user ON public.ai_interaction_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_interaction_logs_curriculum ON public.ai_interaction_logs(curriculum_id);

-- RPC: Export user data (DSGVO Art. 15)
CREATE OR REPLACE FUNCTION public.fn_export_user_data(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_profile jsonb;
  v_progress jsonb;
  v_exams jsonb;
  v_tutor jsonb;
BEGIN
  -- Profile
  SELECT to_jsonb(p.*) INTO v_profile
  FROM profiles p WHERE p.id = p_target_user_id;

  -- Learning progress
  SELECT coalesce(jsonb_agg(to_jsonb(cp.*)), '[]'::jsonb) INTO v_progress
  FROM user_competency_progress cp WHERE cp.user_id = p_target_user_id;

  -- Exam sessions
  SELECT coalesce(jsonb_agg(to_jsonb(es.*)), '[]'::jsonb) INTO v_exams
  FROM exam_sessions es WHERE es.user_id = p_target_user_id;

  -- AI tutor sessions
  SELECT coalesce(jsonb_agg(to_jsonb(ts.*)), '[]'::jsonb) INTO v_tutor
  FROM ai_tutor_sessions ts WHERE ts.user_id = p_target_user_id;

  v_result := jsonb_build_object(
    'exported_at', now(),
    'user_id', p_target_user_id,
    'profile', coalesce(v_profile, '{}'::jsonb),
    'learning_progress', v_progress,
    'exam_sessions', v_exams,
    'ai_tutor_sessions', v_tutor
  );

  -- Log the export request
  INSERT INTO data_export_requests (target_user_id, request_type, status, result_json, requested_by, completed_at)
  VALUES (p_target_user_id, 'export', 'completed', v_result, auth.uid(), now());

  RETURN v_result;
END;
$$;

-- RPC: Request data deletion (DSGVO Art. 17)
CREATE OR REPLACE FUNCTION public.fn_request_data_deletion(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_counts jsonb;
  v_tutor_count integer;
  v_progress_count integer;
BEGIN
  -- Delete AI tutor messages
  DELETE FROM ai_tutor_messages WHERE session_id IN (
    SELECT id FROM ai_tutor_sessions WHERE user_id = p_target_user_id
  );
  GET DIAGNOSTICS v_tutor_count = ROW_COUNT;

  -- Delete AI tutor sessions
  DELETE FROM ai_tutor_sessions WHERE user_id = p_target_user_id;

  -- Anonymize exam data (keep aggregated stats)
  UPDATE exam_sessions SET user_id = '00000000-0000-0000-0000-000000000000'
  WHERE user_id = p_target_user_id;

  -- Delete competency progress
  DELETE FROM user_competency_progress WHERE user_id = p_target_user_id;
  GET DIAGNOSTICS v_progress_count = ROW_COUNT;

  -- Anonymize profile
  UPDATE profiles SET 
    display_name = 'Gelöscht',
    avatar_url = NULL,
    bio = NULL
  WHERE id = p_target_user_id;

  v_deleted_counts := jsonb_build_object(
    'tutor_messages_deleted', v_tutor_count,
    'progress_entries_deleted', v_progress_count,
    'anonymized_at', now()
  );

  INSERT INTO data_export_requests (target_user_id, request_type, status, result_json, requested_by, completed_at)
  VALUES (p_target_user_id, 'deletion', 'completed', v_deleted_counts, auth.uid(), now());

  RETURN v_deleted_counts;
END;
$$;

-- RPC: Generate compliance document
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
  v_id uuid;
  v_version integer;
BEGIN
  SELECT coalesce(max(version), 0) + 1 INTO v_version
  FROM compliance_documents WHERE doc_type = p_doc_type;

  INSERT INTO compliance_documents (doc_type, title, content_md, version, generated_by)
  VALUES (p_doc_type, p_title, p_content_md, v_version, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Storage bucket for compliance docs
INSERT INTO storage.buckets (id, name, public)
VALUES ('compliance-docs', 'compliance-docs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins can manage compliance-docs" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'compliance-docs' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'compliance-docs' AND public.has_role(auth.uid(), 'admin'));
