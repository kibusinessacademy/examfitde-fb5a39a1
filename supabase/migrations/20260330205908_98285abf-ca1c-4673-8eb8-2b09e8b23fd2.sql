
-- ══════════════════════════════════════════════════════════════
-- Meta-Contract-Guard: Prevent raw overwrites of protected meta keys
-- on package_steps for critical step_keys (validate_exam_pool, repair_exam_pool_quality)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_guard_package_step_meta_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  protected_keys text[] := ARRAY[
    'guard_state',
    'stall_reason_code',
    'consecutive_no_progress',
    'last_progress_delta',
    'last_validate_completed_at',
    'last_progress_at',
    'last_guard_action',
    'grace_until',
    'last_repair_completed_at'
  ];
  guarded_steps text[] := ARRAY[
    'validate_exam_pool',
    'repair_exam_pool_quality'
  ];
  k text;
  old_meta jsonb;
  new_meta jsonb;
  lost_keys text[] := '{}';
BEGIN
  -- Only guard specific steps
  IF NOT (NEW.step_key = ANY(guarded_steps)) THEN
    RETURN NEW;
  END IF;

  old_meta := COALESCE(OLD.meta::jsonb, '{}'::jsonb);
  new_meta := COALESCE(NEW.meta::jsonb, '{}'::jsonb);

  -- If old meta had no protected keys, nothing to protect
  IF old_meta = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- If new meta is explicitly NULL or empty, force-merge old protected keys
  IF NEW.meta IS NULL OR new_meta = '{}'::jsonb THEN
    -- Auto-merge: preserve protected keys from old meta
    new_meta := '{}'::jsonb;
    FOREACH k IN ARRAY protected_keys LOOP
      IF old_meta ? k THEN
        new_meta := new_meta || jsonb_build_object(k, old_meta->k);
      END IF;
    END LOOP;
    IF new_meta != '{}'::jsonb THEN
      NEW.meta := new_meta;
    END IF;
    RETURN NEW;
  END IF;

  -- Check for lost protected keys (were in OLD but missing from NEW)
  FOREACH k IN ARRAY protected_keys LOOP
    IF (old_meta ? k) AND NOT (new_meta ? k) THEN
      -- Auto-merge the missing key back from old
      new_meta := new_meta || jsonb_build_object(k, old_meta->k);
    END IF;
  END LOOP;

  NEW.meta := new_meta;
  RETURN NEW;
END;
$$;

-- Drop if exists to avoid duplicate triggers
DROP TRIGGER IF EXISTS trg_guard_package_step_meta_contract ON public.package_steps;

CREATE TRIGGER trg_guard_package_step_meta_contract
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_package_step_meta_contract();

-- Add a comment for discoverability
COMMENT ON FUNCTION public.trg_guard_package_step_meta_contract() IS
  'Meta-Contract-Guard: auto-merges protected meta keys (guard_state, consecutive_no_progress, etc.) '
  'on guarded steps (validate_exam_pool, repair_exam_pool_quality) to prevent accidental data loss from raw overwrites.';
