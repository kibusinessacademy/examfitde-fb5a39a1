
-- Guard: Auto-promote lesson status when generation_status becomes 'generated'
-- Prevents Status-Drift where content is generated but status stays 'placeholder'

CREATE OR REPLACE FUNCTION public.fn_auto_promote_lesson_on_generation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when generation_status changes TO 'generated'
  IF NEW.generation_status = 'generated'
     AND (OLD.generation_status IS DISTINCT FROM 'generated')
     AND NEW.status = 'placeholder'
     AND length(NEW.content::text) > 500
     AND (NEW.content->>'_placeholder') IS NULL
  THEN
    NEW.status := 'active';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_promote_lesson_status
  BEFORE UPDATE OF generation_status ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_promote_lesson_on_generation();
