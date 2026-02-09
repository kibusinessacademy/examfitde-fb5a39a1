-- Create question_attempts table for storing answer submissions
CREATE TABLE IF NOT EXISTS public.question_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  selected_answer INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  session_id UUID,
  answered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_question_attempts_user_id ON public.question_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_question_id ON public.question_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_session_id ON public.question_attempts(session_id);

-- Enable RLS
ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own attempts
CREATE POLICY "Users can view own attempts"
ON public.question_attempts FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users cannot insert directly - only via edge function
-- The edge function uses service role key
CREATE POLICY "Service role can insert attempts"
ON public.question_attempts FOR INSERT
TO service_role
WITH CHECK (true);

-- SSOT Protection: Restrict direct exam_questions access for regular users
-- Drop existing overly permissive policy
DROP POLICY IF EXISTS "Users can view approved questions" ON public.exam_questions;

-- Create restrictive policy - only admins can directly read exam_questions
-- Regular users must use get-exam-questions edge function
CREATE POLICY "Only admins can directly access exam_questions"
ON public.exam_questions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
);

-- Ensure service role can always access for edge functions
CREATE POLICY "Service role full access to exam_questions"
ON public.exam_questions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Create helper function for spaced repetition updates
CREATE OR REPLACE FUNCTION public.update_spaced_repetition(
  p_user_id UUID,
  p_question_id UUID,
  p_is_correct BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competency_id UUID;
BEGIN
  -- Get competency from question
  SELECT competency_id INTO v_competency_id
  FROM exam_questions
  WHERE id = p_question_id;

  IF v_competency_id IS NULL THEN
    RETURN;
  END IF;

  -- Upsert spaced repetition record
  INSERT INTO spaced_repetition_items (
    user_id,
    competency_id,
    question_id,
    ease_factor,
    interval_days,
    repetitions,
    next_review_at,
    last_reviewed_at
  ) VALUES (
    p_user_id,
    v_competency_id,
    p_question_id,
    CASE WHEN p_is_correct THEN 2.5 ELSE 1.3 END,
    CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    CASE WHEN p_is_correct THEN now() + interval '1 day' ELSE now() END,
    now()
  )
  ON CONFLICT (user_id, question_id) 
  DO UPDATE SET
    ease_factor = CASE 
      WHEN p_is_correct THEN LEAST(spaced_repetition_items.ease_factor + 0.1, 3.0)
      ELSE GREATEST(spaced_repetition_items.ease_factor - 0.2, 1.3)
    END,
    interval_days = CASE 
      WHEN p_is_correct THEN CEIL(spaced_repetition_items.interval_days * spaced_repetition_items.ease_factor)
      ELSE 0
    END,
    repetitions = CASE 
      WHEN p_is_correct THEN spaced_repetition_items.repetitions + 1
      ELSE 0
    END,
    next_review_at = CASE 
      WHEN p_is_correct THEN now() + (CEIL(spaced_repetition_items.interval_days * spaced_repetition_items.ease_factor) || ' days')::interval
      ELSE now()
    END,
    last_reviewed_at = now();
END;
$$;