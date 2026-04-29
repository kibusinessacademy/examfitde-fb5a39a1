CREATE OR REPLACE FUNCTION public.submit_quiz_lead(p_quiz_slug text, p_attempt_id uuid, p_email text, p_marketing_consent boolean DEFAULT false, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quiz public.lead_quizzes%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
  v_token text;
  v_lead_id uuid;
BEGIN
  IF p_email IS NULL OR p_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  SELECT * INTO v_quiz FROM public.lead_quizzes WHERE slug = p_quiz_slug AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quiz_not_found');
  END IF;

  IF p_attempt_id IS NOT NULL THEN
    SELECT * INTO v_attempt FROM public.quiz_attempts WHERE id = p_attempt_id AND quiz_id = v_quiz.id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'attempt_not_found');
    END IF;
  END IF;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

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
$function$;