-- Admin-Policies auf authenticated einschränken, damit anon-Reads nicht has_role() triggern.
DROP POLICY IF EXISTS "lead_quizzes_admin_all" ON public.lead_quizzes;
CREATE POLICY "lead_quizzes_admin_all"
  ON public.lead_quizzes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "quiz_questions_admin_all" ON public.quiz_questions;
CREATE POLICY "quiz_questions_admin_all"
  ON public.quiz_questions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "quiz_attempts_admin_all" ON public.quiz_attempts;
CREATE POLICY "quiz_attempts_admin_all"
  ON public.quiz_attempts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "quiz_attempts_owner_select" ON public.quiz_attempts;
CREATE POLICY "quiz_attempts_owner_select"
  ON public.quiz_attempts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "quiz_leads_admin_read" ON public.quiz_leads;
CREATE POLICY "quiz_leads_admin_read"
  ON public.quiz_leads FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "quiz_leads_admin_all" ON public.quiz_leads;
CREATE POLICY "quiz_leads_admin_all"
  ON public.quiz_leads FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));