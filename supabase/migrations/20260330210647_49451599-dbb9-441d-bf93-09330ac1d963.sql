
-- ══════════════════════════════════════════════════════════════
-- Meta-Contract-Guard v2: Add observability signals
-- When the trigger auto-heals, it now stamps:
--   meta_contract_healed_at, meta_contract_healed_keys, meta_contract_heal_count
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
  healed_keys text[] := '{}';
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
    new_meta := '{}'::jsonb;
    FOREACH k IN ARRAY protected_keys LOOP
      IF old_meta ? k THEN
        new_meta := new_meta || jsonb_build_object(k, old_meta->k);
        healed_keys := array_append(healed_keys, k);
      END IF;
    END LOOP;
    IF array_length(healed_keys, 1) > 0 THEN
      new_meta := new_meta || jsonb_build_object(
        'meta_contract_healed_at', now()::text,
        'meta_contract_healed_keys', to_jsonb(healed_keys),
        'meta_contract_heal_count',
          COALESCE((old_meta->>'meta_contract_heal_count')::int, 0) + 1
      );
    END IF;
    NEW.meta := new_meta;
    RETURN NEW;
  END IF;

  -- Check for lost protected keys (were in OLD but missing from NEW)
  FOREACH k IN ARRAY protected_keys LOOP
    IF (old_meta ? k) AND NOT (new_meta ? k) THEN
      new_meta := new_meta || jsonb_build_object(k, old_meta->k);
      healed_keys := array_append(healed_keys, k);
    END IF;
  END LOOP;

  -- Stamp observability if any keys were healed
  IF array_length(healed_keys, 1) > 0 THEN
    new_meta := new_meta || jsonb_build_object(
      'meta_contract_healed_at', now()::text,
      'meta_contract_healed_keys', to_jsonb(healed_keys),
      'meta_contract_heal_count',
        COALESCE((old_meta->>'meta_contract_heal_count')::int, 0) + 1
    );
  END IF;

  NEW.meta := new_meta;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_guard_package_step_meta_contract() IS
  'Meta-Contract-Guard v2: auto-merges protected meta keys on guarded steps '
  'and stamps meta_contract_healed_at/keys/count for forensic observability.';
