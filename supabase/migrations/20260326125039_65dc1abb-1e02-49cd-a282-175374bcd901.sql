CREATE OR REPLACE FUNCTION public.fn_guard_approval_requires_trap_type()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only enforce on transition TO approved
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    -- trap_type is only required for trap questions (is_trap = true)
    IF NEW.is_trap = true AND NEW.trap_type IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRES_TRAP_TYPE: Cannot approve trap question % without trap_type', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;