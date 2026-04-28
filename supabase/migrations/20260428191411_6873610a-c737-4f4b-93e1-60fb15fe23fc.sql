-- ============================================================
-- 1) Fix Syntax in submit_quiz_lead (SELECT * INTO Reihenfolge)
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_quiz_lead(
  p_quiz_slug text,
  p_attempt_id uuid,
  p_email text,
  p_marketing_consent boolean DEFAULT false,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.lead_quizzes%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_token text;
  v_lead_id uuid;
BEGIN
  IF p_email IS NULL OR p_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  SELECT *
    INTO v_quiz
    FROM public.lead_quizzes
   WHERE slug = p_quiz_slug
     AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quiz_not_found');
  END IF;

  IF p_attempt_id IS NOT NULL THEN
    SELECT *
      INTO v_attempt
      FROM public.quiz_attempts
     WHERE id = p_attempt_id
       AND quiz_id = v_quiz.id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'attempt_not_found');
    END IF;
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.quiz_leads(quiz_id, attempt_id, email, curriculum_id, marketing_consent, doi_token, source, metadata)
  VALUES (v_quiz.id, p_attempt_id, lower(trim(p_email)), v_quiz.curriculum_id,
          COALESCE(p_marketing_consent, false), v_token, 'quiz', COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (quiz_id, email) DO UPDATE
    SET attempt_id = EXCLUDED.attempt_id,
        marketing_consent = quiz_leads.marketing_consent OR EXCLUDED.marketing_consent,
        metadata = quiz_leads.metadata || EXCLUDED.metadata
  RETURNING id INTO v_lead_id;

  RETURN jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'doi_token', v_token, 'lernplan_slug', v_quiz.lernplan_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quiz_lead(text, uuid, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quiz_lead(text, uuid, text, boolean, jsonb) TO anon, authenticated;

-- ============================================================
-- 2) RLS-Härtung: kein direkter UPDATE für anon
-- ============================================================
DROP POLICY IF EXISTS "quiz_attempts_owner_update" ON public.quiz_attempts;

-- Nur eingeloggte User dürfen ihre eigenen Attempts updaten (z.B. Resume).
CREATE POLICY "quiz_attempts_authed_owner_update"
  ON public.quiz_attempts FOR UPDATE
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- ============================================================
-- 3) submit_quiz_attempt RPC (SECURITY DEFINER)
--    Ownership: anonymous_id muss matchen ODER user_id = auth.uid()
--    Idempotent: bereits completed → return ok mit "already_completed"
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
  p_attempt_id uuid,
  p_anonymous_id text,
  p_answers jsonb,
  p_score numeric,
  p_passed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.quiz_attempts%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attempt_required');
  END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_score');
  END IF;

  SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attempt_not_found');
  END IF;

  -- Ownership-Check: entweder gleicher auth.uid oder gleiche anonymous_id
  IF v_attempt.user_id IS NOT NULL THEN
    IF auth.uid() IS NULL OR auth.uid() <> v_attempt.user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    IF p_anonymous_id IS NULL OR p_anonymous_id = '' OR p_anonymous_id <> v_attempt.anonymous_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  -- Idempotenz
  IF v_attempt.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true, 'attempt_id', v_attempt.id);
  END IF;

  UPDATE public.quiz_attempts
     SET answers      = COALESCE(p_answers, '[]'::jsonb),
         score        = p_score,
         passed       = COALESCE(p_passed, false),
         completed_at = now()
   WHERE id = p_attempt_id;

  RETURN jsonb_build_object('ok', true, 'attempt_id', p_attempt_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quiz_attempt(uuid, text, jsonb, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(uuid, text, jsonb, numeric, boolean) TO anon, authenticated;