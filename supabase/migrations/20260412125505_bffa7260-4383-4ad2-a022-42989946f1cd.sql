
-- Harden: meta.ok may ONLY exist on status='done'
CREATE OR REPLACE FUNCTION public.fn_guard_ghost_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- meta.ok=true is ONLY valid on done steps
  IF (NEW.meta->>'ok')::boolean = true
     AND NEW.status != 'done'
  THEN
    NEW.meta := NEW.meta - 'ok';
    
    INSERT INTO ops_guardrail_events (guard_key, package_id, step_key, detail)
    VALUES (
      'ghost_completion_blocked',
      NEW.package_id,
      NEW.step_key,
      jsonb_build_object(
        'blocked_status', NEW.status,
        'reason', 'meta.ok=true only allowed on done — flag stripped'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;
