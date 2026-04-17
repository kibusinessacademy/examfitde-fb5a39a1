-- ═══════════════════════════════════════════════════════════════════════════
-- HEAL v8: Repair-Marker, WIP-Bonus für Repair, Reset Exhaustion, content_gap
-- (Tabelle: job_queue mit Spalte 'error', kein step_key — Step liegt in payload)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Repair-Marker auf course_packages
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS is_repair boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS repair_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS repair_marked_by uuid,
  ADD COLUMN IF NOT EXISTS repair_reason text;

CREATE INDEX IF NOT EXISTS idx_course_packages_is_repair
  ON public.course_packages(is_repair) WHERE is_repair = true;

-- 2) WIP-Trigger: Repair-Mode + Bonus-Slots
CREATE OR REPLACE FUNCTION public.fn_enforce_wip_cap_on_building()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_base_cap int := 18;
  v_bonus int := 5;
  v_effective_cap int;
  v_current_building int;
  v_current_repair int;
  v_cfg_val text;
  v_is_repair boolean := false;
BEGIN
  IF NEW.status <> 'building' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'building' THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('course_packages_building_wip_cap'));

  BEGIN
    SELECT value INTO v_cfg_val FROM ops_pipeline_config WHERE key = 'wip_total_cap' LIMIT 1;
    IF v_cfg_val IS NOT NULL THEN v_base_cap := v_cfg_val::int; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    SELECT value INTO v_cfg_val FROM ops_pipeline_config WHERE key = 'wip_bonus_slots' LIMIT 1;
    IF v_cfg_val IS NOT NULL THEN v_bonus := v_cfg_val::int; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v_is_repair := COALESCE(NEW.is_repair, false)
    OR (NEW.blocked_reason IS NOT NULL AND NEW.blocked_reason <> '')
    OR EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = NEW.id
        AND jq.status IN ('pending','processing')
        AND (jq.payload->>'is_repair' = 'true' OR jq.priority <= 10)
    );

  v_effective_cap := CASE WHEN v_is_repair THEN v_base_cap + v_bonus ELSE v_base_cap END;

  SELECT count(*) INTO v_current_building
  FROM course_packages WHERE status = 'building' AND id <> NEW.id;

  IF NOT v_is_repair THEN
    SELECT count(*) INTO v_current_repair
    FROM course_packages WHERE status = 'building' AND id <> NEW.id AND is_repair = true;
    IF (v_current_building - v_current_repair) >= v_base_cap THEN
      RAISE EXCEPTION 'WIP_CAP_EXCEEDED: % non-repair building packages already at base cap %. Cannot transition package %.',
        (v_current_building - v_current_repair), v_base_cap, NEW.id;
    END IF;
  ELSE
    IF v_current_building >= v_effective_cap THEN
      RAISE EXCEPTION 'WIP_CAP_EXCEEDED_REPAIR: % building packages already at effective cap % (base %, bonus %). Cannot transition repair package %.',
        v_current_building, v_effective_cap, v_base_cap, v_bonus, NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) RPC: Mark / Unmark Repair
CREATE OR REPLACE FUNCTION public.admin_mark_package_repair(
  p_package_id uuid,
  p_reason text DEFAULT NULL,
  p_unmark boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_unmark THEN
    UPDATE course_packages
    SET is_repair = false, repair_marked_at = NULL, repair_marked_by = NULL, repair_reason = NULL
    WHERE id = p_package_id;
  ELSE
    UPDATE course_packages
    SET is_repair = true, repair_marked_at = now(), repair_marked_by = v_caller,
        repair_reason = COALESCE(p_reason, 'admin_manual_repair')
    WHERE id = p_package_id;
  END IF;

  INSERT INTO admin_actions (user_id, action, scope, affected_ids, payload)
  VALUES (v_caller,
    CASE WHEN p_unmark THEN 'unmark_repair' ELSE 'mark_repair' END,
    'course_package', ARRAY[p_package_id],
    jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'is_repair', NOT p_unmark);
END;
$$;

-- 4) RPC: Reset Repair-Exhaustion
CREATE OR REPLACE FUNCTION public.admin_reset_repair_exhaustion(
  p_package_id uuid,
  p_step_keys text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_steps_reset int := 0;
  v_jobs_reset int := 0;
BEGIN
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  UPDATE package_steps
  SET attempts = 0,
      meta = COALESCE(meta, '{}'::jsonb)
        - 'guard_state' - 'consecutive_no_progress' - 'hard_stall_count'
        - 'reason_codes' - 'stall_reason_code' - 'last_validate_completed_at'
        || jsonb_build_object('exhaustion_reset_at', now(), 'exhaustion_reset_by', v_caller)
  WHERE package_id = p_package_id
    AND (p_step_keys IS NULL OR step_key = ANY(p_step_keys));
  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  -- job_queue: reset failed/cancelled, bump priority, mark as repair via payload
  UPDATE job_queue
  SET status = 'pending',
      attempts = 0,
      priority = LEAST(COALESCE(priority, 100), 5),
      error = NULL,
      last_error = NULL,
      payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('is_repair', true, 'requeued_via', 'reset_exhaustion'),
      updated_at = now()
  WHERE package_id = p_package_id
    AND status IN ('failed','cancelled');
  GET DIAGNOSTICS v_jobs_reset = ROW_COUNT;

  UPDATE course_packages
  SET is_repair = true, repair_marked_at = now(), repair_marked_by = v_caller,
      repair_reason = COALESCE(repair_reason, 'reset_exhaustion'),
      blocked_reason = NULL, stuck_reason = NULL, last_progress_at = now()
  WHERE id = p_package_id;

  INSERT INTO admin_actions (user_id, action, scope, affected_ids, payload)
  VALUES (v_caller, 'reset_repair_exhaustion', 'course_package',
    ARRAY[p_package_id],
    jsonb_build_object('steps_reset', v_steps_reset, 'jobs_reset', v_jobs_reset, 'step_keys', p_step_keys));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id,
    'steps_reset', v_steps_reset, 'jobs_reset', v_jobs_reset);
END;
$$;

-- 5) RPC: Mark content_gap
CREATE OR REPLACE FUNCTION public.admin_mark_content_gap(
  p_package_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  UPDATE course_packages
  SET status = 'blocked',
      blocked_reason = 'content_gap: ' || COALESCE(p_reason, 'curriculum coverage insufficient'),
      blocked_at = now(),
      blocked_by = 'admin_manual',
      stuck_reason = NULL,
      is_repair = false
  WHERE id = p_package_id;

  UPDATE job_queue
  SET status = 'cancelled',
      error = 'content_gap_marked',
      updated_at = now()
  WHERE package_id = p_package_id
    AND status IN ('pending','processing');

  INSERT INTO admin_actions (user_id, action, scope, affected_ids, payload)
  VALUES (v_caller, 'mark_content_gap', 'course_package',
    ARRAY[p_package_id],
    jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'status', 'blocked');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mark_package_repair(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_repair_exhaustion(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_content_gap(uuid, text) TO authenticated;

-- 6) Auto-Mark via job_queue Trigger
CREATE OR REPLACE FUNCTION public.fn_auto_mark_repair_on_repair_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.package_id IS NOT NULL
     AND NEW.status IN ('pending','processing')
     AND (NEW.payload->>'is_repair' = 'true' OR COALESCE(NEW.priority, 100) <= 10) THEN
    UPDATE course_packages
    SET is_repair = true,
        repair_marked_at = COALESCE(repair_marked_at, now()),
        repair_reason = COALESCE(repair_reason, 'auto_mark_from_repair_job')
    WHERE id = NEW.package_id AND is_repair = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_mark_repair_on_repair_job ON job_queue;
CREATE TRIGGER trg_auto_mark_repair_on_repair_job
  AFTER INSERT OR UPDATE OF status, priority, payload ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_mark_repair_on_repair_job();

-- 7) Auto-Unmark on terminal
CREATE OR REPLACE FUNCTION public.fn_auto_unmark_repair_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('published','archived','blocked')
     AND COALESCE(OLD.status,'') IS DISTINCT FROM NEW.status
     AND NEW.is_repair = true THEN
    UPDATE course_packages
    SET is_repair = false, repair_marked_at = NULL, repair_reason = NULL
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_unmark_repair_on_terminal ON course_packages;
CREATE TRIGGER trg_auto_unmark_repair_on_terminal
  AFTER UPDATE OF status ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_unmark_repair_on_terminal();

COMMENT ON COLUMN public.course_packages.is_repair IS
  'Marker for repair-mode packages — grants WIP bonus slots and high job priority';
COMMENT ON FUNCTION public.fn_enforce_wip_cap_on_building IS
  'Non-repair packages share base cap (wip_total_cap); repair packages get base+bonus (wip_bonus_slots)';