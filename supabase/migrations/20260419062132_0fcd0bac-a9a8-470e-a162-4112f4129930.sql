-- ──────────────────────────────────────────────────────────────
-- 1. Manual Heal Cooldown Column
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS manual_heal_cooldown_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_course_packages_manual_heal_cooldown
  ON public.course_packages (manual_heal_cooldown_until)
  WHERE manual_heal_cooldown_until IS NOT NULL;

COMMENT ON COLUMN public.course_packages.manual_heal_cooldown_until IS
  'Set by admin_manual_heal_package. Auto-heal jobs MUST skip packages with cooldown_until > now() to prevent overriding manual interventions.';

-- ──────────────────────────────────────────────────────────────
-- 2. Patch admin_manual_heal_package: set cooldown + reset repair_attempts
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_manual_heal_package(
  p_package_id uuid,
  p_reset_from_step text,
  p_cancel_active_jobs boolean DEFAULT true,
  p_reason text DEFAULT 'manual_admin_heal',
  p_cooldown_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled_jobs int := 0;
  v_reset_steps    int := 0;
  v_pkg            record;
  v_cooldown_until timestamptz;
BEGIN
  SELECT id, status, blocked_reason, build_metadata
    INTO v_pkg
    FROM course_packages
   WHERE id = p_package_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package % not found', p_package_id;
  END IF;

  v_cooldown_until := now() + make_interval(mins => GREATEST(p_cooldown_minutes, 1));

  -- Cancel active jobs if requested
  IF p_cancel_active_jobs THEN
    UPDATE job_queue
       SET status = 'cancelled',
           cancel_reason = COALESCE(cancel_reason, 'manual_heal:' || p_reason),
           updated_at = now()
     WHERE package_id = p_package_id
       AND status IN ('queued', 'processing', 'pending_enqueue');
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
  END IF;

  -- Reset steps from the requested anchor downstream
  WITH anchor AS (
    SELECT step_order
      FROM package_steps
     WHERE package_id = p_package_id
       AND step_key = p_reset_from_step
     LIMIT 1
  )
  UPDATE package_steps ps
     SET status = 'queued',
         last_error = NULL,
         attempts = 0,
         meta = COALESCE(ps.meta, '{}'::jsonb)
                 - 'repair_attempts'
                 - 'last_repair_at'
                 - 'exhausted'
                 - 'exhausted_at'
                 || jsonb_build_object('manual_heal_at', now(), 'manual_heal_reason', p_reason),
         updated_at = now()
    FROM anchor a
   WHERE ps.package_id = p_package_id
     AND ps.step_order >= a.step_order
     AND ps.status NOT IN ('skipped', 'done');
  GET DIAGNOSTICS v_reset_steps = ROW_COUNT;

  -- Clear blocked_reason, set cooldown, scrub repair counters in build_metadata
  UPDATE course_packages
     SET blocked_reason = NULL,
         status = CASE WHEN status IN ('blocked','failed') THEN 'building' ELSE status END,
         manual_heal_cooldown_until = v_cooldown_until,
         build_metadata = COALESCE(build_metadata, '{}'::jsonb)
                          - 'repair_attempts'
                          - 'last_repair_at'
                          - 'auto_heal_exhausted'
                          || jsonb_build_object(
                              'last_manual_heal_at', now(),
                              'last_manual_heal_reason', p_reason,
                              'last_manual_heal_reset_from', p_reset_from_step
                            ),
         updated_at = now()
   WHERE id = p_package_id;

  -- Audit
  INSERT INTO admin_actions (action, scope, affected_ids, payload)
  VALUES (
    'manual_heal_package',
    'package',
    ARRAY[p_package_id::text],
    jsonb_build_object(
      'reason', p_reason,
      'reset_from_step', p_reset_from_step,
      'cancelled_jobs', v_cancelled_jobs,
      'reset_steps', v_reset_steps,
      'cooldown_until', v_cooldown_until
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'reset_from_step', p_reset_from_step,
    'cancelled_jobs', v_cancelled_jobs,
    'reset_steps', v_reset_steps,
    'cooldown_until', v_cooldown_until,
    'reason', p_reason
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. Patch fn_heal_ghost_completions: catch trigger rejects
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_heal_ghost_completions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             record;
  v_healed          int := 0;
  v_blocked         int := 0;
  v_errors          int := 0;
  v_blocked_details jsonb := '[]'::jsonb;
  v_error_details   jsonb := '[]'::jsonb;
BEGIN
  FOR v_row IN
    SELECT package_id, step_key
      FROM v_ghost_completion_candidates
     LIMIT 200
  LOOP
    BEGIN
      UPDATE package_steps
         SET status = 'done',
             completed_at = COALESCE(completed_at, now()),
             updated_at = now(),
             meta = COALESCE(meta, '{}'::jsonb)
                     || jsonb_build_object('ghost_healed_at', now())
       WHERE package_id = v_row.package_id
         AND step_key = v_row.step_key
         AND status <> 'done';
      v_healed := v_healed + 1;

    EXCEPTION
      WHEN raise_exception OR check_violation OR integrity_constraint_violation THEN
        v_blocked := v_blocked + 1;
        v_blocked_details := v_blocked_details || jsonb_build_object(
          'package_id', v_row.package_id,
          'step_key', v_row.step_key,
          'reason', 'guard_rejected',
          'sqlerrm', SQLERRM
        );
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_error_details := v_error_details || jsonb_build_object(
          'package_id', v_row.package_id,
          'step_key', v_row.step_key,
          'sqlstate', SQLSTATE,
          'sqlerrm', SQLERRM
        );
    END;
  END LOOP;

  -- Audit
  INSERT INTO admin_actions (action, scope, payload)
  VALUES (
    'heal_ghost_completions',
    'system',
    jsonb_build_object(
      'healed', v_healed,
      'blocked_by_guard', v_blocked,
      'errors', v_errors,
      'blocked_details', v_blocked_details,
      'error_details', v_error_details
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'healed', v_healed,
    'skipped_blocked_by_guard', v_blocked,
    'errors', v_errors,
    'blocked_details', v_blocked_details,
    'error_details', v_error_details
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. Patch fn_auto_heal_repair_exhausted_meta_aware: respect cooldown
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_func_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_auto_heal_repair_exhausted_meta_aware'
  ) INTO v_func_exists;

  IF v_func_exists THEN
    -- Recreate guarded version
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.fn_auto_heal_repair_exhausted_meta_aware()
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_processed int := 0;
        v_skipped_cooldown int := 0;
        v_pkg record;
      BEGIN
        FOR v_pkg IN
          SELECT cp.id AS package_id, cp.manual_heal_cooldown_until
            FROM course_packages cp
           WHERE cp.status IN ('blocked','building')
             AND COALESCE(cp.build_metadata->>'repair_attempts','0')::int >= 3
        LOOP
          -- Cooldown guard: skip packages under manual heal protection
          IF v_pkg.manual_heal_cooldown_until IS NOT NULL
             AND v_pkg.manual_heal_cooldown_until > now() THEN
            v_skipped_cooldown := v_skipped_cooldown + 1;
            CONTINUE;
          END IF;

          -- Mark as exhausted (legacy behavior preserved)
          UPDATE course_packages
             SET blocked_reason = COALESCE(blocked_reason, 'repair_exhausted_meta_aware'),
                 status = 'blocked',
                 build_metadata = COALESCE(build_metadata,'{}'::jsonb)
                                   || jsonb_build_object('auto_heal_exhausted', true,
                                                         'auto_heal_exhausted_at', now())
           WHERE id = v_pkg.package_id;
          v_processed := v_processed + 1;
        END LOOP;

        RETURN jsonb_build_object(
          'ok', true,
          'processed', v_processed,
          'skipped_cooldown', v_skipped_cooldown
        );
      END;
      $body$;
    $f$;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_manual_heal_package(uuid, text, boolean, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_heal_ghost_completions() TO service_role;