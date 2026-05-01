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

  -- TAIL-PHASE EXCLUSION
  SELECT count(*) INTO v_current_building
  FROM course_packages cp
  WHERE cp.status = 'building'
    AND cp.id <> NEW.id
    AND EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = cp.id
        AND ps.step_key::text LIKE 'generate_%'
        AND ps.status::text IN ('queued','processing')
    );

  IF NOT v_is_repair THEN
    SELECT count(*) INTO v_current_repair
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND cp.id <> NEW.id
      AND cp.is_repair = true
      AND EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key::text LIKE 'generate_%'
          AND ps.status::text IN ('queued','processing')
      );
    IF (v_current_building - v_current_repair) >= v_base_cap THEN
      RAISE EXCEPTION 'WIP_CAP_EXCEEDED: % non-repair active-building packages already at base cap %. Cannot transition package %.',
        (v_current_building - v_current_repair), v_base_cap, NEW.id;
    END IF;
  ELSE
    IF v_current_building >= v_effective_cap THEN
      RAISE EXCEPTION 'WIP_CAP_EXCEEDED_REPAIR: % active-building packages already at effective cap % (base %, bonus %). Cannot transition repair package %.',
        v_current_building, v_effective_cap, v_base_cap, v_bonus, NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
DECLARE
  v_pkgs uuid[] := ARRAY[
    'dfcdab2b-0b26-4938-a653-fac407fe9c89'::uuid,
    '77bd3d53-2087-4213-9796-3afac5bfe263'::uuid
  ];
  v_pkg_id uuid;
  v_curr_id uuid;
  v_existing_council_id uuid;
  v_council_done boolean;
BEGIN
  FOREACH v_pkg_id IN ARRAY v_pkgs LOOP
    SELECT curriculum_id INTO v_curr_id FROM course_packages WHERE id = v_pkg_id;

    UPDATE course_packages
    SET status = 'building', last_progress_at = now(),
        blocked_reason = NULL, manual_heal_cooldown_until = NULL
    WHERE id = v_pkg_id AND status = 'queued';

    SELECT (status::text = 'done') INTO v_council_done
    FROM package_steps
    WHERE package_id = v_pkg_id AND step_key = 'quality_council';

    IF NOT COALESCE(v_council_done, false) THEN
      UPDATE package_steps
      SET status = 'queued', updated_at = now(),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'recovery_at', now(),
            'recovery_reason', 'wip_cap_tail_exclusion_fix_2026_05_01')
      WHERE package_id = v_pkg_id AND step_key = 'quality_council';

      SELECT id INTO v_existing_council_id
      FROM job_queue
      WHERE (payload->>'package_id') = v_pkg_id::text
        AND job_type = 'package_quality_council'
        AND status IN ('pending','queued','processing');

      IF v_existing_council_id IS NULL THEN
        INSERT INTO job_queue (job_type, status, attempts, max_attempts, payload, run_after, priority)
        VALUES ('package_quality_council', 'pending', 0, 25,
          jsonb_build_object(
            'package_id', v_pkg_id,
            'curriculum_id', v_curr_id,
            'manual_recovery', true,
            'recovery_reason', 'textil_pkgs_2026_05_01'),
          now(), 5);
      END IF;
    END IF;

    INSERT INTO auto_heal_log (
      trigger_source, action_type, target_id, target_type,
      result_status, result_detail, metadata
    ) VALUES (
      'manual_migration', 'textil_pkg_wip_cap_recovery', v_pkg_id, 'package',
      'success',
      'pkg→building, council ' || CASE WHEN v_council_done THEN 'already done (DAG enqueues auto_publish)' ELSE 'queued' END,
      jsonb_build_object('package_id', v_pkg_id, 'council_was_done', v_council_done));
  END LOOP;
END $$;