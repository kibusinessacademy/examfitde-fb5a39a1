
-- Extend run status to include 'rejected'
ALTER TABLE public.document_agent_runs
  DROP CONSTRAINT IF EXISTS document_agent_runs_status_check;
ALTER TABLE public.document_agent_runs
  ADD CONSTRAINT document_agent_runs_status_check
  CHECK (status = ANY (ARRAY['draft','generating','generated','needs_review','approved','rejected','exported','archived','failed']::text[]));

-- ============ document_agent_reviews ============
CREATE TABLE IF NOT EXISTS public.document_agent_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.document_agent_runs(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','needs_changes','cancelled')),
  review_notes text,
  compliance_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dar_reviews_run ON public.document_agent_reviews(run_id);
CREATE INDEX IF NOT EXISTS idx_dar_reviews_org_status ON public.document_agent_reviews(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dar_reviews_requested_by ON public.document_agent_reviews(requested_by, created_at DESC);

ALTER TABLE public.document_agent_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews_select_owner_or_org_or_admin"
  ON public.document_agent_reviews FOR SELECT
  USING (
    requested_by = auth.uid()
    OR reviewer_id = auth.uid()
    OR (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id))
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

-- INSERT/UPDATE only via RPCs (service role); deny direct DML
CREATE POLICY "reviews_no_direct_write"
  ON public.document_agent_reviews FOR INSERT
  WITH CHECK (false);
CREATE POLICY "reviews_no_direct_update"
  ON public.document_agent_reviews FOR UPDATE
  USING (false);

-- ============ document_agent_review_comments ============
CREATE TABLE IF NOT EXISTS public.document_agent_review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.document_agent_reviews(id) ON DELETE CASCADE,
  section_key text,
  comment text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dar_comments_review ON public.document_agent_review_comments(review_id, created_at);

ALTER TABLE public.document_agent_review_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "review_comments_select_via_review"
  ON public.document_agent_review_comments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.document_agent_reviews r
    WHERE r.id = review_id
      AND (
        r.requested_by = auth.uid()
        OR r.reviewer_id = auth.uid()
        OR (r.organization_id IS NOT NULL AND public.is_org_member(auth.uid(), r.organization_id))
        OR public.has_role(auth.uid(), 'admin'::app_role)
      )
  ));

CREATE POLICY "review_comments_no_direct_write"
  ON public.document_agent_review_comments FOR INSERT
  WITH CHECK (false);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_doc_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_doc_review_touch ON public.document_agent_reviews;
CREATE TRIGGER trg_doc_review_touch BEFORE UPDATE ON public.document_agent_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_review_touch();

-- ============ RPCs ============

-- Request a review for a run (owner or org member)
CREATE OR REPLACE FUNCTION public.doc_agent_request_review(
  _run_id uuid,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run record;
  v_review_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT r.*, t.risk_level AS tpl_risk
  INTO v_run
  FROM public.document_agent_runs r
  JOIN public.document_agent_templates t ON t.id = r.template_id
  WHERE r.id = _run_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;

  IF v_run.user_id <> v_uid
     AND NOT (v_run.organization_id IS NOT NULL AND public.is_org_member(v_uid, v_run.organization_id))
     AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Skip if an open review already exists
  SELECT id INTO v_review_id FROM public.document_agent_reviews
    WHERE run_id = _run_id AND status IN ('pending','needs_changes')
    ORDER BY created_at DESC LIMIT 1;
  IF v_review_id IS NOT NULL THEN
    RETURN v_review_id;
  END IF;

  INSERT INTO public.document_agent_reviews
    (run_id, organization_id, requested_by, status, review_notes, risk_level, compliance_flags)
  VALUES
    (_run_id, v_run.organization_id, v_uid, 'pending', _notes, v_run.tpl_risk,
     COALESCE(v_run.compliance_warnings, '[]'::jsonb))
  RETURNING id INTO v_review_id;

  UPDATE public.document_agent_runs
    SET status = 'needs_review', review_required = true, updated_at = now()
    WHERE id = _run_id;

  RETURN v_review_id;
END $$;

REVOKE ALL ON FUNCTION public.doc_agent_request_review(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_agent_request_review(uuid, text) TO authenticated;

-- Submit decision (approve / reject / needs_changes)
CREATE OR REPLACE FUNCTION public.doc_agent_submit_decision(
  _review_id uuid,
  _decision text,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_review record;
  v_new_run_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _decision NOT IN ('approved','rejected','needs_changes') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  SELECT * INTO v_review FROM public.document_agent_reviews WHERE id = _review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;

  -- Reviewer must be org member (if org-bound) or platform admin; self-approval blocked for high risk
  IF NOT (
    (v_review.organization_id IS NOT NULL AND public.is_org_member(v_uid, v_review.organization_id))
    OR public.has_role(v_uid, 'admin'::app_role)
    OR (v_review.organization_id IS NULL AND v_review.risk_level <> 'high' AND v_review.requested_by = v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_review.risk_level = 'high' AND v_review.requested_by = v_uid
     AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'self_approval_forbidden_high_risk';
  END IF;

  v_new_run_status := CASE _decision
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'needs_review'
  END;

  UPDATE public.document_agent_reviews
    SET status = _decision,
        reviewer_id = v_uid,
        reviewed_at = now(),
        review_notes = COALESCE(_notes, review_notes)
    WHERE id = _review_id;

  UPDATE public.document_agent_runs
    SET status = v_new_run_status,
        reviewed_by = v_uid,
        reviewed_at = now(),
        review_notes = COALESCE(_notes, review_notes),
        updated_at = now()
    WHERE id = v_review.run_id;

  RETURN jsonb_build_object('ok', true, 'decision', _decision, 'run_status', v_new_run_status);
END $$;

REVOKE ALL ON FUNCTION public.doc_agent_submit_decision(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_agent_submit_decision(uuid, text, text) TO authenticated;

-- Add a comment
CREATE OR REPLACE FUNCTION public.doc_agent_add_review_comment(
  _review_id uuid,
  _comment text,
  _section_key text DEFAULT NULL,
  _severity text DEFAULT 'info'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_review record;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _severity NOT IN ('info','warning','critical') THEN RAISE EXCEPTION 'invalid_severity'; END IF;
  IF coalesce(length(trim(_comment)),0) = 0 THEN RAISE EXCEPTION 'empty_comment'; END IF;

  SELECT * INTO v_review FROM public.document_agent_reviews WHERE id = _review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;

  IF NOT (
    v_review.requested_by = v_uid
    OR v_review.reviewer_id = v_uid
    OR (v_review.organization_id IS NOT NULL AND public.is_org_member(v_uid, v_review.organization_id))
    OR public.has_role(v_uid, 'admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.document_agent_review_comments(review_id, section_key, comment, severity, created_by)
  VALUES (_review_id, _section_key, _comment, _severity, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.doc_agent_add_review_comment(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_agent_add_review_comment(uuid, text, text, text) TO authenticated;

-- List reviews relevant for current user (pending = inbox)
CREATE OR REPLACE FUNCTION public.doc_agent_list_reviews(
  _status text DEFAULT NULL,
  _limit int DEFAULT 50
) RETURNS TABLE (
  review_id uuid,
  run_id uuid,
  template_title text,
  template_category text,
  risk_level text,
  status text,
  organization_id uuid,
  requested_by uuid,
  reviewer_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz,
  review_notes text,
  compliance_flags jsonb,
  generated_excerpt text,
  comment_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rv.id,
    rv.run_id,
    t.title,
    t.category,
    rv.risk_level,
    rv.status,
    rv.organization_id,
    rv.requested_by,
    rv.reviewer_id,
    rv.reviewed_at,
    rv.created_at,
    rv.review_notes,
    rv.compliance_flags,
    LEFT(COALESCE(r.generated_document,''), 280) AS generated_excerpt,
    (SELECT COUNT(*)::int FROM public.document_agent_review_comments c WHERE c.review_id = rv.id)
  FROM public.document_agent_reviews rv
  JOIN public.document_agent_runs r ON r.id = rv.run_id
  JOIN public.document_agent_templates t ON t.id = r.template_id
  WHERE (_status IS NULL OR rv.status = _status)
    AND (
      rv.requested_by = auth.uid()
      OR rv.reviewer_id = auth.uid()
      OR (rv.organization_id IS NOT NULL AND public.is_org_member(auth.uid(), rv.organization_id))
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  ORDER BY
    CASE rv.status WHEN 'pending' THEN 0 WHEN 'needs_changes' THEN 1 ELSE 2 END,
    rv.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 200));
$$;
REVOKE ALL ON FUNCTION public.doc_agent_list_reviews(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_agent_list_reviews(text, int) TO authenticated;

-- Get full review detail (with run document + comments)
CREATE OR REPLACE FUNCTION public.doc_agent_get_review(_review_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT jsonb_build_object(
    'review', to_jsonb(rv),
    'run', jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'generated_document', r.generated_document,
      'structured_sections', r.structured_sections,
      'compliance_warnings', r.compliance_warnings,
      'quality_score', r.quality_score,
      'created_at', r.created_at
    ),
    'template', jsonb_build_object(
      'id', t.id, 'title', t.title, 'category', t.category,
      'risk_level', t.risk_level, 'output_sections', t.output_sections
    ),
    'comments', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
      FROM public.document_agent_review_comments c WHERE c.review_id = rv.id
    ), '[]'::jsonb)
  )
  INTO v
  FROM public.document_agent_reviews rv
  JOIN public.document_agent_runs r ON r.id = rv.run_id
  JOIN public.document_agent_templates t ON t.id = r.template_id
  WHERE rv.id = _review_id
    AND (
      rv.requested_by = v_uid OR rv.reviewer_id = v_uid
      OR (rv.organization_id IS NOT NULL AND public.is_org_member(v_uid, rv.organization_id))
      OR public.has_role(v_uid, 'admin'::app_role)
    );

  IF v IS NULL THEN RAISE EXCEPTION 'forbidden_or_not_found'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.doc_agent_get_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_agent_get_review(uuid) TO authenticated;

-- ============ Export-Guard: high-risk must be approved ============
CREATE OR REPLACE FUNCTION public.tg_guard_doc_export_requires_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run record;
  v_tpl_risk text;
BEGIN
  SELECT r.status, r.user_id, t.risk_level
    INTO v_run
  FROM public.document_agent_runs r
  JOIN public.document_agent_templates t ON t.id = r.template_id
  WHERE r.id = NEW.run_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'export_guard:run_not_found'; END IF;

  IF v_run.risk_level = 'high' AND v_run.status NOT IN ('approved','exported') THEN
    RAISE EXCEPTION 'export_guard:high_risk_requires_approval (run_status=%)', v_run.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_doc_export_requires_approval ON public.document_agent_exports;
CREATE TRIGGER trg_guard_doc_export_requires_approval
  BEFORE INSERT ON public.document_agent_exports
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_doc_export_requires_approval();
