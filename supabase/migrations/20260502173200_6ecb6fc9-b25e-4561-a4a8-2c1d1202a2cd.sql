
CREATE OR REPLACE FUNCTION public.fn_guard_conversion_event_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean := false;
  v_is_smoke boolean := false;
  v_is_sim boolean := false;
BEGIN
  IF NEW.event_type IN (
    'checkout_started',
    'checkout_complete',
    'checkout_completed',
    'lead_capture_submitted',
    'quiz_started',
    'quiz_completed'
  ) THEN
    IF NEW.package_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_allowed  := COALESCE((NEW.metadata->>'allow_missing_package_id')::boolean, false);
    v_is_smoke := COALESCE((NEW.metadata->>'smoke_test')::boolean, false);
    v_is_sim   := COALESCE((NEW.metadata->>'simulation')::boolean, false);

    IF v_allowed OR v_is_smoke OR v_is_sim THEN
      RETURN NEW;
    END IF;

    -- Audit via WARNING ins Postgres-Log (überlebt Rollback)
    RAISE WARNING 'IDENTITY_CONTRACT_VIOLATION_AUDIT event_type=% session=% user=% metadata=%',
      NEW.event_type, NEW.session_id, NEW.user_id, NEW.metadata;

    -- Best-effort Tabellen-Audit (wird beim Rollback verworfen, aber dokumentiert)
    BEGIN
      INSERT INTO public.conversion_event_violations
        (event_type, attempted_metadata, attempted_user_id, attempted_session_id, reason)
      VALUES
        (NEW.event_type, NEW.metadata, NEW.user_id, NEW.session_id,
         'IDENTITY_CONTRACT_VIOLATION: package_id required');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RAISE EXCEPTION 'IDENTITY_CONTRACT_VIOLATION: package_id is required for event_type=%', NEW.event_type
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
