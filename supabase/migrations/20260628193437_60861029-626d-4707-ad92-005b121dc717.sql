
CREATE OR REPLACE FUNCTION public.fn_conversion_events_attribution_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requires_package boolean;
  v_strict boolean;
  v_scope text;
  v_has_pkg boolean;
BEGIN
  SELECT requires_package, strict, scope
    INTO v_requires_package, v_strict, v_scope
  FROM public.conversion_event_attribution_policy
  WHERE event_type = NEW.event_type;

  IF NOT FOUND OR COALESCE(v_requires_package, false) = false THEN
    RETURN NEW;
  END IF;

  v_has_pkg := (NEW.package_id IS NOT NULL)
            OR (NEW.metadata ? 'package_id' AND NULLIF(NEW.metadata->>'package_id','') IS NOT NULL);

  IF v_has_pkg THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'conversion_event_attribution_violation',
      'conversion_event',
      NULL,
      CASE WHEN COALESCE(v_strict,false) THEN 'blocked' ELSE 'observed' END,
      jsonb_build_object(
        'event_type', NEW.event_type,
        'session_id', NEW.session_id,
        'page_path', NEW.page_path,
        'strict', COALESCE(v_strict,false),
        'scope', v_scope
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF COALESCE(v_strict,false) THEN
    RAISE EXCEPTION 'attribution_required: event_type=% needs package context', NEW.event_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $function$;
