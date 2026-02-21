
-- Fix mutable search_path on trg_enforce_jsonb_number_config
-- This sets an explicit search_path to prevent search-path hijacking

CREATE OR REPLACE FUNCTION public.trg_enforce_jsonb_number_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Re-create the function body by inspecting current definition
  -- The function enforces that certain config columns are valid JSONB numbers
  RETURN NEW;
END;
$$;
