
-- Phase 4A: Community Workflow Submissions Foundation

CREATE TYPE berufs_ki_submission_status AS ENUM (
  'draft','pending_precheck','pending_review','needs_changes',
  'approved','approved_with_edits','merged','rejected','deprecated'
);

CREATE TABLE public.berufs_ki_workflow_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  goal text NOT NULL,
  beruf_slug text,
  category text NOT NULL CHECK (category IN ('kommunikation','analyse','dokumentation','organisation','fach','lernhilfe')),
  curriculum_id uuid,
  proposed_inputs jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  proposed_outputs jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  workflow_steps text NOT NULL,
  risks text,
  proposed_competencies text[],
  status berufs_ki_submission_status NOT NULL DEFAULT 'pending_precheck',
  precheck jsonb,
  precheck_at timestamptz,
  duplicate_score numeric,
  governance_score numeric,
  quality_score numeric,
  merge_candidate_ids uuid[],
  reviewer_notes text,
  promoted_definition_id uuid REFERENCES public.berufs_ki_workflow_definitions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bki_subs_status ON public.berufs_ki_workflow_submissions(status, created_at DESC);
CREATE INDEX idx_bki_subs_user ON public.berufs_ki_workflow_submissions(submitted_by, created_at DESC);

ALTER TABLE public.berufs_ki_workflow_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view own submissions"
  ON public.berufs_ki_workflow_submissions FOR SELECT
  USING (submitted_by = auth.uid() OR has_role(auth.uid(),'admin'));

CREATE POLICY "users can create submissions"
  ON public.berufs_ki_workflow_submissions FOR INSERT
  WITH CHECK (submitted_by = auth.uid());

CREATE POLICY "users can update own draft submissions"
  ON public.berufs_ki_workflow_submissions FOR UPDATE
  USING (submitted_by = auth.uid() AND status IN ('draft','needs_changes'))
  WITH CHECK (submitted_by = auth.uid());

CREATE POLICY "admins can update any submission"
  ON public.berufs_ki_workflow_submissions FOR UPDATE
  USING (has_role(auth.uid(),'admin'));

CREATE TABLE public.berufs_ki_workflow_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.berufs_ki_workflow_submissions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('approve','approve_with_edits','request_changes','reject','merge','deprecate','precheck')),
  notes text,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bki_reviews_sub ON public.berufs_ki_workflow_reviews(submission_id, created_at DESC);
ALTER TABLE public.berufs_ki_workflow_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read reviews" ON public.berufs_ki_workflow_reviews FOR SELECT USING (has_role(auth.uid(),'admin'));
CREATE POLICY "admins insert reviews" ON public.berufs_ki_workflow_reviews FOR INSERT WITH CHECK (has_role(auth.uid(),'admin') AND reviewer_id = auth.uid());

CREATE TABLE public.berufs_ki_workflow_merge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.berufs_ki_workflow_submissions(id) ON DELETE CASCADE,
  candidate_definition_id uuid REFERENCES public.berufs_ki_workflow_definitions(id) ON DELETE CASCADE,
  candidate_submission_id uuid REFERENCES public.berufs_ki_workflow_submissions(id) ON DELETE CASCADE,
  similarity_score numeric NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (candidate_definition_id IS NOT NULL OR candidate_submission_id IS NOT NULL)
);
CREATE INDEX idx_bki_merge_sub ON public.berufs_ki_workflow_merge_candidates(submission_id);
ALTER TABLE public.berufs_ki_workflow_merge_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read merge" ON public.berufs_ki_workflow_merge_candidates FOR SELECT USING (has_role(auth.uid(),'admin'));

-- updated_at trigger
CREATE TRIGGER trg_bki_subs_updated BEFORE UPDATE ON public.berufs_ki_workflow_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Admin RPC: list submissions with filters
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_list_submissions(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, title text, goal text, beruf_slug text, category text,
  status berufs_ki_submission_status, duplicate_score numeric, governance_score numeric, quality_score numeric,
  submitted_by uuid, submitter_email text, merge_candidate_count int,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.title, s.goal, s.beruf_slug, s.category, s.status,
         s.duplicate_score, s.governance_score, s.quality_score,
         s.submitted_by,
         (SELECT email FROM auth.users u WHERE u.id = s.submitted_by) AS submitter_email,
         COALESCE(array_length(s.merge_candidate_ids, 1), 0) AS merge_candidate_count,
         s.created_at, s.updated_at
  FROM public.berufs_ki_workflow_submissions s
  WHERE has_role(auth.uid(),'admin')
    AND (p_status IS NULL OR s.status::text = p_status)
  ORDER BY s.created_at DESC
  LIMIT 500;
$$;

-- Admin RPC: approve submission → create workflow definition
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_approve_submission(
  p_submission_id uuid,
  p_slug text,
  p_system_prompt text,
  p_user_prompt_template text,
  p_tier text DEFAULT 'free',
  p_with_edits boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub public.berufs_ki_workflow_submissions%ROWTYPE;
  v_def_id uuid;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_sub FROM public.berufs_ki_workflow_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission not found'; END IF;

  INSERT INTO public.berufs_ki_workflow_definitions (
    slug, title, description, category, curriculum_id, target_roles, tier_required,
    risk_level, compliance_level, model_recommendation,
    system_prompt, user_prompt_template, input_schema, output_schema, is_active
  ) VALUES (
    p_slug, v_sub.title, v_sub.goal, v_sub.category, v_sub.curriculum_id,
    ARRAY['fachkraft']::text[], p_tier,
    'low','standard','google/gemini-2.5-pro',
    p_system_prompt, p_user_prompt_template,
    v_sub.proposed_inputs, v_sub.proposed_outputs, true
  )
  RETURNING id INTO v_def_id;

  UPDATE public.berufs_ki_workflow_submissions
     SET status = CASE WHEN p_with_edits THEN 'approved_with_edits'::berufs_ki_submission_status
                        ELSE 'approved'::berufs_ki_submission_status END,
         promoted_definition_id = v_def_id,
         updated_at = now()
   WHERE id = p_submission_id;

  INSERT INTO public.berufs_ki_workflow_reviews (submission_id, reviewer_id, action, notes)
  VALUES (p_submission_id, auth.uid(),
          CASE WHEN p_with_edits THEN 'approve_with_edits' ELSE 'approve' END,
          'promoted to definition '||v_def_id::text);

  RETURN v_def_id;
END;
$$;

-- Admin RPC: change submission status
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_review_submission(
  p_submission_id uuid,
  p_action text,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_status berufs_ki_submission_status;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_status := CASE p_action
    WHEN 'request_changes' THEN 'needs_changes'
    WHEN 'reject' THEN 'rejected'
    WHEN 'merge' THEN 'merged'
    WHEN 'deprecate' THEN 'deprecated'
    ELSE NULL END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'invalid action %', p_action; END IF;

  UPDATE public.berufs_ki_workflow_submissions
     SET status = v_status, reviewer_notes = COALESCE(p_notes, reviewer_notes), updated_at = now()
   WHERE id = p_submission_id;

  INSERT INTO public.berufs_ki_workflow_reviews (submission_id, reviewer_id, action, notes)
  VALUES (p_submission_id, auth.uid(), p_action, p_notes);
END;
$$;

-- Community Intelligence Analytics RPC
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_community_intelligence(p_window_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'submissions_total', (SELECT count(*) FROM berufs_ki_workflow_submissions WHERE created_at > now() - make_interval(days => p_window_days)),
    'pending_review', (SELECT count(*) FROM berufs_ki_workflow_submissions WHERE status='pending_review'),
    'needs_changes', (SELECT count(*) FROM berufs_ki_workflow_submissions WHERE status='needs_changes'),
    'approved', (SELECT count(*) FROM berufs_ki_workflow_submissions WHERE status IN ('approved','approved_with_edits') AND created_at > now() - make_interval(days => p_window_days)),
    'rejected', (SELECT count(*) FROM berufs_ki_workflow_submissions WHERE status='rejected' AND created_at > now() - make_interval(days => p_window_days)),
    'top_categories', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT category, count(*) c FROM berufs_ki_workflow_submissions
            WHERE created_at > now() - make_interval(days => p_window_days)
            GROUP BY category ORDER BY c DESC LIMIT 6) t
    ),
    'top_berufe', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('beruf_slug', beruf_slug, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (SELECT beruf_slug, count(*) c FROM berufs_ki_workflow_submissions
            WHERE beruf_slug IS NOT NULL AND created_at > now() - make_interval(days => p_window_days)
            GROUP BY beruf_slug ORDER BY c DESC LIMIT 10) t
    ),
    'avg_quality', (SELECT round(avg(quality_score)::numeric, 2) FROM berufs_ki_workflow_submissions WHERE quality_score IS NOT NULL AND created_at > now() - make_interval(days => p_window_days))
  );
$$;

REVOKE ALL ON FUNCTION public.admin_berufs_ki_list_submissions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_berufs_ki_approve_submission(uuid,text,text,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_berufs_ki_review_submission(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_berufs_ki_community_intelligence(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_list_submissions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_approve_submission(uuid,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_review_submission(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_community_intelligence(int) TO authenticated;
