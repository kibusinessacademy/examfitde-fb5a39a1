
-- Add max_active_packages setting to llm_budget (reuse as global config)
ALTER TABLE public.llm_budget ADD COLUMN IF NOT EXISTS max_active_packages integer NOT NULL DEFAULT 4;

-- Update current row
UPDATE public.llm_budget SET max_active_packages = 4 WHERE true;
