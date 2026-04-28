DROP POLICY IF EXISTS "quiz_attempts_anyone_insert" ON public.quiz_attempts;
CREATE POLICY "quiz_attempts_anyone_insert"
  ON public.quiz_attempts FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND user_id IS NULL AND anonymous_id IS NOT NULL)
  );