
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(
  p_runner_id text,
  p_lease_seconds int DEFAULT 120,
  p_track text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_wip_limit int;
  v_building_count_global int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
  v_attempt int := 0;
  v_max_attempts int := 8;
  v_min_incomplete_priority int;
  v_allowed_priority int;
  v_unblocked int;
  v_orphan_reclaimed int;
  v_priority_gate int;
BEGIN
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages';
    v_max_slots := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_max_slots := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'priority_gate_rank';
    v_priority_gate := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_priority_gate := NULL; END;

  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);
  v_priority_gate := COALESCE(v_priority_gate, 50);

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  -- ORPHAN RECLAIM: only packages with NO queued steps (truly done/stuck)
  UPDATE public.course_packages cp
  SET status = 'queued', updated_at = now()
  WHERE cp.status = 'building'
    AND (p_track IS NULL OR cp.track::text = p_track)
    AND NOT EXISTS (SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id)
    AND NOT EXISTS (SELECT 1 FROM public.job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending', 'processing'))
    AND NOT EXISTS (SELECT 1 FROM public.package_steps ps WHERE ps.package_id = cp.id AND ps.status IN ('running', 'enqueued'))
    AND NOT EXISTS (SELECT 1 FROM public.package_steps ps WHERE ps.package_id = cp.id AND ps.status = 'queued');

  GET DIAGNOSTICS v_orphan_reclaimed = ROW_COUNT;
  IF v_orphan_reclaimed > 0 THEN
    RAISE LOG '[acquire_v2] Reclaimed % true orphan building packages (no queued steps)', v_orphan_reclaimed;
  END IF;

  SELECT count(*) INTO v_rebuild_count FROM public.course_packages WHERE status = 'building' AND is_rebuild = true;
  SELECT count(*) INTO v_building_count_global FROM public.course_packages WHERE status = 'building';
  v_effective_wip := v_wip_limit + v_rebuild_count;

  -- ADMISSION GATE
  IF v_building_count_global >= v_effective_wip THEN
    BEGIN
      INSERT INTO auto_heal_log (trigger_source, action_type, result_status, result_detail, metadata)
      VALUES ('acquire_v2', 'wip_admission_blocked', 'blocked',
        format('Global WIP %s >= cap %s. Runner=%s, track=%s', v_building_count_global, v_effective_wip, p_runner_id, COALESCE(p_track, 'any')),
        jsonb_build_object('building_count', v_building_count_global, 'effective_wip', v_effective_wip, 'runner_id', p_runner_id, 'track', p_track));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END IF;

  -- UNBLOCK (using subquery instead of LIMIT)
  WITH to_unblock AS (
    SELECT id FROM public.course_packages
    WHERE status = 'blocked'
      AND (p_track IS NULL OR track::text = p_track)
      AND (blocked_reason IS NULL OR blocked_reason = '')
    LIMIT 5
  )
  UPDATE public.course_packages SET status = 'queued', blocked_reason = NULL, updated_at = now()
  WHERE id IN (SELECT id FROM to_unblock);

  -- PRIORITY GATE
  SELECT MIN(priority) INTO v_min_incomplete_priority
  FROM public.course_packages
  WHERE status IN ('building', 'queued')
    AND (p_track IS NULL OR track::text = p_track);
  v_allowed_priority := COALESCE(v_min_incomplete_priority, 50) + v_priority_gate;

  -- ACQUIRE LOOP
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > v_max_attempts THEN RETURN NULL; END IF;

    SELECT id INTO v_package_id
    FROM public.course_packages
    WHERE status = 'queued'
      AND (p_track IS NULL OR track::text = p_track)
      AND priority <= v_allowed_priority
      AND NOT EXISTS (SELECT 1 FROM public.package_leases pl WHERE pl.package_id = course_packages.id)
    ORDER BY priority ASC, updated_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_package_id IS NULL THEN RETURN NULL; END IF;

    -- Double-check WIP inside the lock
    SELECT count(*) INTO v_building_count_global FROM public.course_packages WHERE status = 'building';
    IF v_building_count_global >= v_effective_wip THEN RETURN NULL; END IF;

    UPDATE public.course_packages SET status = 'building', updated_at = now() WHERE id = v_package_id;

    INSERT INTO public.package_leases (package_id, runner_id, lease_until)
    VALUES (v_package_id, p_runner_id, now() + (p_lease_seconds || ' seconds')::interval)
    ON CONFLICT (package_id) DO UPDATE
    SET runner_id = p_runner_id, lease_until = now() + (p_lease_seconds || ' seconds')::interval;

    RETURN v_package_id;
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- PACKAGE HEALS
-- ══════════════════════════════════════════════════════════════

-- Büromanagement: re-promote
UPDATE course_packages SET status = 'building', updated_at = now()
WHERE id = '5377ab93-fe17-488c-a266-bdb26b672da7' AND status = 'queued';

-- Bankkaufmann: unblock generate_lesson_minichecks
UPDATE package_steps
SET status = 'queued', last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) - 'loop_guard_blocked' - 'loop_guard_blocked_at' - 'loop_guard_reason' - 'loop_guard_metrics',
    updated_at = now()
WHERE package_id = 'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb'
  AND step_key = 'generate_lesson_minichecks' AND status = 'blocked';

-- Verkäufer: promote from QGF
UPDATE course_packages SET status = 'building', updated_at = now()
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04' AND status = 'quality_gate_failed';

-- AEVO: reset exam pool steps
UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, attempts = 0,
    last_error = NULL, meta = '{}'::jsonb, updated_at = now()
WHERE package_id = 'b960658d-95e9-4824-a404-821d5e9b5142'
  AND step_key IN ('auto_seed_exam_blueprints', 'generate_exam_pool')
  AND status IN ('done', 'failed', 'blocked');

UPDATE job_queue
SET status = 'cancelled', error = 'Manual: threshold exhausted, needs reseed', updated_at = now()
WHERE package_id = 'b960658d-95e9-4824-a404-821d5e9b5142'
  AND job_type = 'package_generate_exam_pool' AND status = 'failed';

-- Fachkraft Lagerlogistik: cancel zombie + reset step
UPDATE job_queue
SET status = 'cancelled', error = 'Manual: zombie processing >15min', updated_at = now()
WHERE package_id = 'f2039067-e58a-4e94-9573-b5953d435873'
  AND job_type = 'package_validate_lesson_minichecks' AND status = 'processing';

UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL, attempts = 0, updated_at = now()
WHERE package_id = 'f2039067-e58a-4e94-9573-b5953d435873'
  AND step_key = 'validate_lesson_minichecks' AND status IN ('running', 'enqueued');

-- Audit
INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail)
VALUES
  ('manual_repair', 'fix_orphan_reclaim_logic', NULL, 'system', 'applied', 'acquire_v2: orphan reclaim now skips packages with queued steps'),
  ('manual_repair', 'heal_buero', '5377ab93-fe17-488c-a266-bdb26b672da7', 'package', 'applied', 'Büromanagement: re-promoted after orphan reclaim fix'),
  ('manual_repair', 'unblock_loop_guard', 'de6c5c13-1a5c-4dcb-bb5c-92c4c23632eb', 'package', 'applied', 'Bankkaufmann: unblocked generate_lesson_minichecks'),
  ('manual_repair', 'promote_qgf', '59b6e214-e181-4c2b-986e-1ce544984d04', 'package', 'applied', 'Verkäufer: QGF→building'),
  ('manual_repair', 'reset_exam_pool', 'b960658d-95e9-4824-a404-821d5e9b5142', 'package', 'applied', 'AEVO: reset exam pool steps'),
  ('manual_repair', 'cancel_zombie', 'f2039067-e58a-4e94-9573-b5953d435873', 'package', 'applied', 'Fachkraft: cancelled zombie processing');
