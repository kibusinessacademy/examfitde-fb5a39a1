
-- 1. Lock down AI workflow definitions: drop public read
DROP POLICY IF EXISTS "berufs_ki_wfd_public_read_active" ON public.berufs_ki_workflow_definitions;

-- (Admin policy berufs_ki_wfd_admin_all remains; edge functions use service_role.)

-- 2. Lock down quiz_attempts: drop unscoped anon SELECT
DROP POLICY IF EXISTS "quiz_attempts_anon_select_own" ON public.quiz_attempts;

-- 3. Provide scoped public RPCs (SECURITY DEFINER) for the anon quiz flow.

-- 3a. Insert a new attempt (anon or authed)
CREATE OR REPLACE FUNCTION public.public_insert_quiz_attempt(
  _quiz_id uuid,
  _curriculum_id uuid,
  _anonymous_id text,
  _session_id text,
  _user_agent text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    IF _anonymous_id IS NULL OR length(_anonymous_id) < 8 THEN
      RAISE EXCEPTION 'anonymous_id required for anonymous attempts';
    END IF;
  END IF;

  INSERT INTO public.quiz_attempts (
    quiz_id, curriculum_id, anonymous_id, session_id, user_agent, user_id
  ) VALUES (
    _quiz_id, _curriculum_id,
    CASE WHEN v_uid IS NULL THEN _anonymous_id ELSE NULL END,
    _session_id, _user_agent, v_uid
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.public_insert_quiz_attempt(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_insert_quiz_attempt(uuid,uuid,text,text,text) TO anon, authenticated;

-- 3b. Read one attempt by id + anonymous_id (anon) or by auth.uid() (authed)
CREATE OR REPLACE FUNCTION public.public_get_quiz_attempt_result(
  _attempt_id uuid,
  _anonymous_id text
) RETURNS TABLE (
  id uuid,
  score numeric,
  passed boolean,
  curriculum_id uuid,
  completed_at timestamptz,
  started_at timestamptz,
  quiz_id uuid,
  user_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT qa.id, qa.score, qa.passed, qa.curriculum_id,
         qa.completed_at, qa.started_at, qa.quiz_id, qa.user_id
  FROM public.quiz_attempts qa
  WHERE qa.id = _attempt_id
    AND (
      (auth.uid() IS NOT NULL AND qa.user_id = auth.uid())
      OR (auth.uid() IS NULL AND qa.user_id IS NULL
          AND _anonymous_id IS NOT NULL
          AND qa.anonymous_id = _anonymous_id)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.public_get_quiz_attempt_result(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_quiz_attempt_result(uuid,text) TO anon, authenticated;

-- 3c. Count this visitor's recent attempts for a curriculum (for lead-gate)
CREATE OR REPLACE FUNCTION public.public_count_recent_quiz_attempts(
  _curriculum_id uuid,
  _anonymous_id text,
  _since timestamptz
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.quiz_attempts qa
  WHERE qa.curriculum_id = _curriculum_id
    AND qa.started_at >= _since
    AND (
      (auth.uid() IS NOT NULL AND qa.user_id = auth.uid())
      OR (auth.uid() IS NULL AND qa.user_id IS NULL
          AND _anonymous_id IS NOT NULL
          AND qa.anonymous_id = _anonymous_id)
    );
$$;

REVOKE ALL ON FUNCTION public.public_count_recent_quiz_attempts(uuid,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_count_recent_quiz_attempts(uuid,text,timestamptz) TO anon, authenticated;
