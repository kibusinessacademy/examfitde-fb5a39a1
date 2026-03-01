
-- =============================================================
-- lesson_answer_keys: SSOT for exemplar answers, checklists, keywords
-- =============================================================
CREATE TABLE public.lesson_answer_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  exemplar_answer TEXT NOT NULL,
  checklist TEXT[] NOT NULL DEFAULT '{}',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  rubric JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lesson_id)
);

ALTER TABLE public.lesson_answer_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read answer keys"
  ON public.lesson_answer_keys FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage answer keys"
  ON public.lesson_answer_keys FOR ALL
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_lesson_answer_keys_updated_at
  BEFORE UPDATE ON public.lesson_answer_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: Deterministic answer check (keyword + checklist match)
CREATE OR REPLACE FUNCTION public.check_lesson_answer(
  p_lesson_id UUID,
  p_user_answer TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key RECORD;
  v_answer_lower TEXT;
  v_found_keywords TEXT[] := '{}';
  v_missing_keywords TEXT[] := '{}';
  v_found_checklist TEXT[] := '{}';
  v_missing_checklist TEXT[] := '{}';
  v_kw TEXT;
  v_ci TEXT;
  v_keyword_score NUMERIC;
  v_checklist_score NUMERIC;
  v_total_score NUMERIC;
BEGIN
  SELECT * INTO v_key FROM lesson_answer_keys WHERE lesson_id = p_lesson_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no_answer_key', 'message', 'Für diese Lektion ist noch keine Musterlösung hinterlegt.');
  END IF;

  v_answer_lower := lower(p_user_answer);

  IF array_length(v_key.keywords, 1) IS NOT NULL THEN
    FOREACH v_kw IN ARRAY v_key.keywords LOOP
      IF v_answer_lower LIKE '%' || lower(v_kw) || '%' THEN
        v_found_keywords := array_append(v_found_keywords, v_kw);
      ELSE
        v_missing_keywords := array_append(v_missing_keywords, v_kw);
      END IF;
    END LOOP;
    v_keyword_score := round(array_length(v_found_keywords, 1)::NUMERIC / array_length(v_key.keywords, 1)::NUMERIC * 100);
  ELSE
    v_keyword_score := 0;
  END IF;

  IF array_length(v_key.checklist, 1) IS NOT NULL THEN
    FOREACH v_ci IN ARRAY v_key.checklist LOOP
      IF v_answer_lower LIKE '%' || lower(split_part(v_ci, ' ', 1)) || '%' THEN
        v_found_checklist := array_append(v_found_checklist, v_ci);
      ELSE
        v_missing_checklist := array_append(v_missing_checklist, v_ci);
      END IF;
    END LOOP;
    v_checklist_score := round(array_length(v_found_checklist, 1)::NUMERIC / array_length(v_key.checklist, 1)::NUMERIC * 100);
  ELSE
    v_checklist_score := 0;
  END IF;

  v_total_score := round(v_keyword_score * 0.6 + v_checklist_score * 0.4);

  RETURN jsonb_build_object(
    'score', v_total_score,
    'keyword_score', v_keyword_score,
    'checklist_score', v_checklist_score,
    'found_keywords', to_jsonb(v_found_keywords),
    'missing_keywords', to_jsonb(v_missing_keywords),
    'found_checklist', to_jsonb(v_found_checklist),
    'missing_checklist', to_jsonb(v_missing_checklist),
    'has_exemplar', true
  );
END;
$$;
