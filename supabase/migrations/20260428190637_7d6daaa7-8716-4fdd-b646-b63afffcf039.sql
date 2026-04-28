-- ============================================================
-- Lead-Magnet Quiz Engine (Loop A — Funnel Phase 1)
-- ============================================================

CREATE TABLE public.lead_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text,
  description text,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  lernplan_slug text,
  pass_threshold numeric NOT NULL DEFAULT 0.8 CHECK (pass_threshold >= 0 AND pass_threshold <= 1),
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_quizzes_slug_active ON public.lead_quizzes(slug) WHERE is_active = true;
CREATE INDEX idx_lead_quizzes_curriculum ON public.lead_quizzes(curriculum_id);

CREATE TABLE public.quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.lead_quizzes(id) ON DELETE CASCADE,
  position int NOT NULL,
  question_text text NOT NULL,
  options jsonb NOT NULL,
  weight numeric NOT NULL DEFAULT 1 CHECK (weight > 0),
  topic_tag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, position)
);
CREATE INDEX idx_quiz_questions_quiz ON public.quiz_questions(quiz_id, position);

CREATE TABLE public.quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.lead_quizzes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  anonymous_id text,
  session_id text,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  score numeric,
  passed boolean,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (user_id IS NOT NULL OR anonymous_id IS NOT NULL)
);
CREATE INDEX idx_quiz_attempts_quiz ON public.quiz_attempts(quiz_id);
CREATE INDEX idx_quiz_attempts_user ON public.quiz_attempts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_quiz_attempts_anon ON public.quiz_attempts(anonymous_id) WHERE anonymous_id IS NOT NULL;
CREATE INDEX idx_quiz_attempts_completed ON public.quiz_attempts(completed_at DESC) WHERE completed_at IS NOT NULL;

CREATE TABLE public.quiz_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.lead_quizzes(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.quiz_attempts(id) ON DELETE SET NULL,
  email text NOT NULL,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  doi_token text,
  doi_confirmed_at timestamptz,
  source text NOT NULL DEFAULT 'quiz',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, email)
);
CREATE INDEX idx_quiz_leads_email ON public.quiz_leads(email);
CREATE INDEX idx_quiz_leads_quiz ON public.quiz_leads(quiz_id);
CREATE INDEX idx_quiz_leads_doi ON public.quiz_leads(doi_confirmed_at) WHERE doi_confirmed_at IS NOT NULL;

CREATE TRIGGER trg_lead_quizzes_updated_at
  BEFORE UPDATE ON public.lead_quizzes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.lead_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_quizzes_public_read_active"
  ON public.lead_quizzes FOR SELECT USING (is_active = true);
CREATE POLICY "lead_quizzes_admin_all"
  ON public.lead_quizzes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "quiz_questions_public_read_active"
  ON public.quiz_questions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.lead_quizzes q WHERE q.id = quiz_questions.quiz_id AND q.is_active = true));
CREATE POLICY "quiz_questions_admin_all"
  ON public.quiz_questions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "quiz_attempts_anyone_insert"
  ON public.quiz_attempts FOR INSERT
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND user_id IS NULL AND anonymous_id IS NOT NULL)
  );
CREATE POLICY "quiz_attempts_owner_update"
  ON public.quiz_attempts FOR UPDATE
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND user_id IS NULL)
  );
CREATE POLICY "quiz_attempts_owner_select"
  ON public.quiz_attempts FOR SELECT
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "quiz_attempts_admin_all"
  ON public.quiz_attempts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "quiz_leads_admin_read"
  ON public.quiz_leads FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "quiz_leads_admin_all"
  ON public.quiz_leads FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RPC submit_quiz_lead
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

-- Pilot-Seed (Curricula-Lookup über title)
DO $$
DECLARE
  v_quiz_id uuid;
  v_curriculum_id uuid;
BEGIN
  SELECT id INTO v_curriculum_id FROM public.curricula
   WHERE lower(coalesce(title, '')) LIKE 'aevo%'
   LIMIT 1;

  INSERT INTO public.lead_quizzes(slug, title, subtitle, description, curriculum_id, lernplan_slug, pass_threshold, is_active)
  VALUES (
    'aevo-pruefungsreife',
    'AEVO-Prüfungsreife in 5 Fragen',
    'Dein Selbsttest für die Ausbildereignungsprüfung',
    'Finde in 2 Minuten heraus, wie prüfungsreif du wirklich bist – inkl. persönlichem Lernplan.',
    v_curriculum_id,
    'aevo-pruefungsreife',
    0.8,
    true
  )
  ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
  RETURNING id INTO v_quiz_id;

  INSERT INTO public.quiz_questions(quiz_id, position, question_text, options, weight, topic_tag) VALUES
    (v_quiz_id, 1, 'Welche vier Handlungsfelder umfasst die AEVO?',
     '[{"key":"a","label":"Planen, Durchführen, Kontrollieren, Verbessern","is_correct":false},{"key":"b","label":"Voraussetzungen prüfen, Ausbildung vorbereiten, durchführen, abschließen","is_correct":true,"explanation":"Die vier AEVO-Handlungsfelder."},{"key":"c","label":"Fachlich, methodisch, sozial, persönlich","is_correct":false},{"key":"d","label":"Theorie, Praxis, Prüfung, Nachbereitung","is_correct":false}]'::jsonb, 1, 'handlungsfelder'),
    (v_quiz_id, 2, 'Wie lange dauert die schriftliche AEVO-Prüfung?',
     '[{"key":"a","label":"90 Minuten","is_correct":false},{"key":"b","label":"120 Minuten","is_correct":false},{"key":"c","label":"180 Minuten","is_correct":true,"explanation":"3 Stunden."},{"key":"d","label":"240 Minuten","is_correct":false}]'::jsonb, 1, 'pruefungsformat'),
    (v_quiz_id, 3, 'Welche Methode eignet sich am besten zur Vermittlung einer komplexen praktischen Tätigkeit?',
     '[{"key":"a","label":"Lehrgespräch","is_correct":false},{"key":"b","label":"Vier-Stufen-Methode","is_correct":true,"explanation":"Vorbereiten, Vormachen, Nachmachen, Üben."},{"key":"c","label":"Frontalunterricht","is_correct":false},{"key":"d","label":"Brainstorming","is_correct":false}]'::jsonb, 1, 'methodik'),
    (v_quiz_id, 4, 'Welches Gesetz regelt die Berufsausbildung in Deutschland?',
     '[{"key":"a","label":"Arbeitsschutzgesetz (ArbSchG)","is_correct":false},{"key":"b","label":"Berufsbildungsgesetz (BBiG)","is_correct":true,"explanation":"BBiG ist die rechtliche Grundlage."},{"key":"c","label":"Jugendarbeitsschutzgesetz (JArbSchG)","is_correct":false},{"key":"d","label":"Tarifvertragsgesetz (TVG)","is_correct":false}]'::jsonb, 1, 'recht'),
    (v_quiz_id, 5, 'Wie lange dauert die praktische AEVO-Prüfung (Präsentation + Fachgespräch zusammen)?',
     '[{"key":"a","label":"max. 30 Minuten","is_correct":true,"explanation":"15 Min Präsentation + max. 15 Min Fachgespräch."},{"key":"b","label":"max. 45 Minuten","is_correct":false},{"key":"c","label":"max. 60 Minuten","is_correct":false},{"key":"d","label":"max. 90 Minuten","is_correct":false}]'::jsonb, 1, 'pruefungsformat')
  ON CONFLICT (quiz_id, position) DO NOTHING;
END $$;