
-- Universal Recovery Shield: prevents ANY guard from resetting recently-recovered packages
CREATE OR REPLACE FUNCTION public.guard_recovery_grace_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status changes FROM building TO queued/failed/blocked
  IF OLD.status = 'building' 
     AND NEW.status IN ('queued', 'failed', 'blocked')
     AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    -- Check 1: Package was updated to building less than 10 minutes ago
    IF OLD.updated_at > now() - interval '10 minutes' THEN
      -- Check if there's a recent recovery for this package
      IF EXISTS (
        SELECT 1 FROM public.auto_heal_log
        WHERE target_id = OLD.id::text
          AND action_type = 'recover_and_reenter_package'
          AND result_status = 'success'
          AND created_at > now() - interval '15 minutes'
      ) THEN
        -- Block the reset, keep building
        RAISE WARNING 'RECOVERY_SHIELD: Blocked % → % for package % (within grace period)', 
          OLD.status, NEW.status, OLD.id;
        NEW.status := OLD.status;
        NEW.updated_at := OLD.updated_at;
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Install as BEFORE UPDATE trigger with high priority (runs before other guards)
DROP TRIGGER IF EXISTS trg_00_recovery_grace_shield ON public.course_packages;
CREATE TRIGGER trg_00_recovery_grace_shield
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_recovery_grace_period();

-- Re-enter the 10 packages (Wave 1, Attempt 6 — now with universal shield)
DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '188daeb5-205e-4fb4-aadc-de59029406f5','398573ab-bc9d-4fc9-9d8e-3607c24f3bf9',
    '575a917a-bd7c-48df-afc0-bda29389c40f','5d23ff92-0f91-4f19-a01b-3b7f8edc38ff',
    '6337d885-bd02-4d4f-aaa5-fb118d643cd8','92d333cf-bbd3-4292-b85b-ba933c7c4ae1',
    'ae384df2-2ce2-4842-8074-3c9f0ebbb414','c636b6bc-fcae-4d8f-b8ca-87647d9fee6c',
    'e90a5e24-5a51-4afa-aeae-0b97407eadee','ebbc4dcb-ff3a-43fb-b9d1-dad8d1e22de3'
  ];
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM public.recover_and_reenter_package(
      v_id, 'wave1-attempt6: universal recovery shield trigger installed', 'ops_panel', NULL
    );
  END LOOP;
END;
$$;
