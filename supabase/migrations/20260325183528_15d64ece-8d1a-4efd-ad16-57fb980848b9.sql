-- Add expected_trap_type to question_blueprints
-- Uses exam-question taxonomy: misconception, typical_error, calculation_trap
ALTER TABLE public.question_blueprints
  ADD COLUMN IF NOT EXISTS expected_trap_type text;

-- Backfill from trap_spec.trap_type using didactically sound mapping:
-- isolated_knowledge → misconception (conceptual confusion)
-- error_detection → typical_error (procedural error detection)
-- applied_case → typical_error (application-context errors)
-- multi_step_case → calculation_trap (multi-step computational traps)
-- legal_evaluation → misconception (legal concept confusion)
UPDATE public.question_blueprints
SET expected_trap_type = CASE
  WHEN trap_spec->>'trap_type' = 'isolated_knowledge' THEN 'misconception'
  WHEN trap_spec->>'trap_type' = 'error_detection'    THEN 'typical_error'
  WHEN trap_spec->>'trap_type' = 'applied_case'       THEN 'typical_error'
  WHEN trap_spec->>'trap_type' = 'multi_step_case'    THEN 'calculation_trap'
  WHEN trap_spec->>'trap_type' = 'legal_evaluation'   THEN 'misconception'
  -- Bloom-level fallbacks for rare/legacy values
  WHEN trap_spec->>'trap_type' IN ('understand','analyze') THEN 'misconception'
  WHEN trap_spec->>'trap_type' IN ('apply') THEN 'typical_error'
  WHEN trap_spec->>'trap_type' IN ('evaluate') THEN 'typical_error'
  ELSE 'typical_error'
END
WHERE expected_trap_type IS NULL;