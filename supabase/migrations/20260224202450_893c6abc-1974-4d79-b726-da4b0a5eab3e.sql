
-- Add 'create' to bloom_level check constraint (Bloom Level 6: Synthese/Gestalten)
ALTER TABLE public.competencies DROP CONSTRAINT competencies_bloom_level_check;
ALTER TABLE public.competencies ADD CONSTRAINT competencies_bloom_level_check 
  CHECK (bloom_level = ANY (ARRAY['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']));
