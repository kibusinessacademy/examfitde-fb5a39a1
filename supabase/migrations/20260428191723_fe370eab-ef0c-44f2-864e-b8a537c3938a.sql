-- GRANTs für die Quiz-Engine
GRANT SELECT ON public.lead_quizzes TO anon, authenticated;
GRANT SELECT ON public.quiz_questions TO anon, authenticated;
GRANT SELECT, INSERT ON public.quiz_attempts TO anon, authenticated;
GRANT UPDATE ON public.quiz_attempts TO authenticated;
-- quiz_leads bewusst NICHT granted (nur über RPC submit_quiz_lead).