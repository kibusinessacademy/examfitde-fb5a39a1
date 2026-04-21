CREATE OR REPLACE FUNCTION public.fn_guard_blueprint_placeholder_soft()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_placeholder boolean := false;
  v_status text;
BEGIN
  v_status := COALESCE(NEW.status::text, 'draft');

  -- Draft-Templates dürfen Platzhalter enthalten (Variantenfähigkeit).
  -- Nur bei Promotion zu approved/active greift die Deprecation.
  IF v_status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.question_template ~ '\{[A-Za-z_][A-Za-z0-9_]*\}' THEN
    v_has_placeholder := true;
  END IF;

  IF v_has_placeholder THEN
    NEW.status := 'deprecated';
    NEW.deprecated_at := COALESCE(NEW.deprecated_at, now());
    NEW.change_reason := COALESCE(
      NEW.change_reason,
      'AUTO_DEPRECATED_PLACEHOLDER_ON_PROMOTE: unresolved placeholders in non-draft template'
    );
  END IF;

  RETURN NEW;
END;
$function$;