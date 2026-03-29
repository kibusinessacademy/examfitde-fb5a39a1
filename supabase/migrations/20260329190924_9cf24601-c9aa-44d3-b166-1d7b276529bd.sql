
-- Guard: prevent anything from setting provider_verified except
-- the verify edge functions (which use service_role).
-- This trigger ensures reconcile, admin tools, or migrations
-- cannot accidentally upgrade to provider_verified.

CREATE OR REPLACE FUNCTION public.guard_provider_verified_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status is being changed TO provider_verified
  IF NEW.verification_status = 'provider_verified'
     AND (OLD.verification_status IS DISTINCT FROM 'provider_verified') THEN
    -- Allow if coming from the verify functions (which set provider_verification_json)
    -- The verify functions always set provider_verification_json with verified=true
    IF NEW.provider_verification_json IS NULL
       OR (NEW.provider_verification_json->>'verified')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'provider_verified status requires valid provider_verification_json with verified=true. Use verify-apple-purchase or verify-google-purchase edge functions.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop if exists to allow re-creation
DROP TRIGGER IF EXISTS trg_guard_provider_verified ON public.mobile_store_purchase_events;

CREATE TRIGGER trg_guard_provider_verified
  BEFORE UPDATE ON public.mobile_store_purchase_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_provider_verified_upgrade();
