
-- ═══════════════════════════════════════════════════════════════
-- P0 FIX: Make all package_steps inserts idempotent
-- Root cause: package_steps_sort_order_guard raises DUPLICATE_STEP_KEY
-- on INSERT, pre-empting ON CONFLICT DO NOTHING and rolling back
-- the entire transaction (including the triggering UPDATE).
-- ═══════════════════════════════════════════════════════════════

-- 1. Fix the sort_order_guard: silently skip duplicate inserts
CREATE OR REPLACE FUNCTION public.package_steps_sort_order_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Guard: step_key must not be empty
  IF NEW.step_key IS NULL OR NEW.step_key = '' THEN
    RAISE EXCEPTION 'INVALID_STEP_KEY: step_key must not be empty (package_id=%)', NEW.package_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Guard: no duplicate step_key per package
  IF TG_OP = 'INSERT' THEN
    -- Idempotent: if step already exists, silently cancel this INSERT.
    -- The UNIQUE constraint (package_id, step_key) is the real guard;
    -- we just prevent the exception from rolling back the caller's transaction.
    IF EXISTS (
      SELECT 1 FROM public.package_steps ps
      WHERE ps.package_id = NEW.package_id
        AND ps.step_key = NEW.step_key
        AND ps.id <> NEW.id
    ) THEN
      -- Log for observability, then cancel the insert (RETURN NULL = skip row)
      INSERT INTO public.ops_guardrail_events (guard_key, details)
      VALUES ('duplicate_step_insert_suppressed', jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'suppressed_at', now()
      ));
      RETURN NULL;  -- ← silently skip instead of RAISE EXCEPTION
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.step_key IS DISTINCT FROM NEW.step_key THEN
    IF EXISTS (
      SELECT 1 FROM public.package_steps ps
      WHERE ps.package_id = NEW.package_id
        AND ps.step_key = NEW.step_key
        AND ps.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_STEP_KEY: package=% step_key=%', NEW.package_id, NEW.step_key
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Create the central idempotent helper
CREATE OR REPLACE FUNCTION public.ensure_package_step(
  p_package_id uuid,
  p_step_key text,
  p_status text DEFAULT 'queued',
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted boolean;
BEGIN
  INSERT INTO public.package_steps (
    package_id,
    step_key,
    status,
    meta,
    created_at,
    updated_at
  )
  VALUES (
    p_package_id,
    p_step_key,
    p_status::step_status,
    p_meta || jsonb_build_object('seeded_by', 'ensure_package_step', 'seeded_at', now()::text),
    now(),
    now()
  )
  ON CONFLICT (package_id, step_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END;
$$;

-- 3. Fix repair_missing_finalize_artifact to use ensure_package_step
CREATE OR REPLACE FUNCTION public.repair_missing_finalize_artifact(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_created boolean := false;
  v_validate_reset boolean := false;
BEGIN
  SELECT public.ensure_package_step(p_package_id, 'finalize_learning_content', 'pending') INTO v_created;

  UPDATE package_steps
  SET status = 'pending', attempts = 0, updated_at = now()
  WHERE package_id = p_package_id
    AND step_key = 'validate_learning_content'
    AND status IN ('failed', 'blocked');
  GET DIAGNOSTICS v_validate_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'finalize_created', COALESCE(v_created, false),
    'validate_reset', COALESCE(v_validate_reset, false)
  );
END;
$function$;

-- 4. Drop redundant unique index (keep the constraint, drop the duplicate index)
DROP INDEX IF EXISTS public.package_steps_pkg_step_uq;
