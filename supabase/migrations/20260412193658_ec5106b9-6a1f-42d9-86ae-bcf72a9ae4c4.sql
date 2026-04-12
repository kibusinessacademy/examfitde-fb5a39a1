
-- Drop the ambiguous no-arg overload; keep only the version with p_mode parameter
DROP FUNCTION IF EXISTS public.fn_heal_ghost_completions();
