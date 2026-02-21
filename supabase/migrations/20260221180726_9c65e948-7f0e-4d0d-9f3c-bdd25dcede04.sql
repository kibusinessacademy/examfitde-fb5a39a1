
-- Add question_type to exam_questions for tracking calculation/case_study/transfer
ALTER TABLE public.exam_questions 
ADD COLUMN IF NOT EXISTS question_type text NOT NULL DEFAULT 'concept';

-- Add CHECK constraint for valid types
ALTER TABLE public.exam_questions 
ADD CONSTRAINT chk_question_type CHECK (question_type IN ('concept', 'procedure', 'calculation', 'case_study', 'transfer'));

-- Index for KPI queries
CREATE INDEX IF NOT EXISTS idx_exam_questions_question_type ON public.exam_questions(question_type);

-- Backfill: heuristic classification of existing questions
UPDATE public.exam_questions
SET question_type = CASE
  WHEN question_text ~* '(berechne|ermittle|kalkulier|wie hoch|wie viel|welcher betrag|welche summe|prozent|€|euro|marge|spanne|zuschlag|rabatt|skonto|bezugspreis|einstandspreis|verkaufspreis|wareneinsatz|rohgewinn|deckungsbeitrag|inventurdifferenz|schwund)'
    AND question_text ~* '[0-9]'
    THEN 'calculation'
  WHEN question_text ~* '(ein kunde|eine kundin|herr |frau |in ihrer filiale|ein lieferant|szenario|situation|fall|stellen sie sich vor)'
    AND length(question_text) > 150
    THEN 'case_study'
  WHEN question_text ~* '(welche maßnahme|was würden sie|wie reagieren|entscheiden sie|beurteilen sie|bewerten sie|vergleichen sie)'
    THEN 'transfer'
  WHEN question_text ~* '(erklären sie|beschreiben sie|nennen sie|definieren sie|was versteht man|was bedeutet|welche aufgabe)'
    THEN 'concept'
  ELSE 'concept'
END
WHERE question_type = 'concept';
