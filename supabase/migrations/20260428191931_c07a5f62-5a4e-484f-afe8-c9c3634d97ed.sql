CREATE POLICY "quiz_attempts_anon_select_anon_rows"
  ON public.quiz_attempts FOR SELECT
  TO anon
  USING (user_id IS NULL AND anonymous_id IS NOT NULL);