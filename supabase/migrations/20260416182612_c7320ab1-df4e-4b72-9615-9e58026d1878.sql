
-- ════════════════════════════════════════════════════════════════
-- CAUSALITY-DRIFT GOVERNANCE v1
-- 1. Reconciler: Artefakt-zu-Step Drift (Blueprints da, Seed queued)
-- 2. Anti-Hotloop Guard: generate_exam_pool blockieren wenn Upstream offen
-- 3. Stale-Lock Counter Fix: meta-basierter Counter statt attempts
-- ════════════════════════════════════════════════════════════════

-- ─── 1. RECONCILER: Auto-finalisiere auto_seed_exam_blueprints ───
CREATE OR REPLACE FUNCTION public.fn_reconcile_seed_blueprints_causality()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rec RECORD;
  v_reconciled int := 0;
  v_skipped int := 0;
  v_packages jsonb := '[]'::jsonb;
BEGIN
  FOR v_rec IN
    SELECT 
      cp.id AS package_id,
      cp.curriculum_id,
      ps.id AS step_id,
      ps.status AS step_status,
      (SELECT COUNT(*) FROM question_blueprints qb 
       WHERE qb.curriculum_id = cp.curriculum_id 
         AND qb.status != 'deprecated') AS bp_count
    FROM course_packages cp
    JOIN package_steps ps 
      ON ps.package_id = cp.id 
     AND ps.step_key = 'auto_seed_exam_blueprints'
    WHERE ps.status IN ('queued','failed','blocked')
      AND cp.status NOT IN ('archived','deleted')
      -- only reconcile if no active job for seeding is currently running
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.payload->>'package_id' = cp.id::text
          AND jq.job_type = 'package_auto_seed_exam_blueprints'
          AND jq.status IN ('processing','running','batch_pending','pending')
      )
  LOOP
    -- Hard guard: only reconcile if real blueprints exist
    IF v_rec.bp_count <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.admin_force_steps_done(
        v_rec.package_id,
        ARRAY['auto_seed_exam_blueprints']::text[],
        format('artifact_reconciled: %s blueprints exist; step state synced to SSOT', v_rec.bp_count),
        false,
        false
      );
      v_reconciled := v_reconciled + 1;
      v_packages := v_packages || jsonb_build_object(
        'package_id', v_rec.package_id,
        'blueprints', v_rec.bp_count,
        'prev_status', v_rec.step_status
      );
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO admin_actions (action, scope, affected_ids, payload)
      VALUES (
        'reconciler_seed_blueprints_failed',
        'package',
        ARRAY[v_rec.package_id::text],
        jsonb_build_object('error', SQLERRM, 'blueprints', v_rec.bp_count)
      );
    END;
  END LOOP;

  IF v_reconciled > 0 THEN
    INSERT INTO admin_actions (action, scope, affected_ids, payload)
    VALUES (
      'reconciler_seed_blueprints_run',
      'system',
      NULL,
      jsonb_build_object('reconciled', v_reconciled, 'skipped', v_skipped, 'packages', v_packages)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reconciled', v_reconciled,
    'skipped', v_skipped,
    'packages', v_packages,
    'ran_at', now()
  );
END;
$$;

-- ─── 2. ANTI-HOTLOOP GUARD: generate_exam_pool ───────────────
CREATE OR REPLACE FUNCTION public.fn_guard_generate_exam_pool_causality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_seed_status text;
  v_validate_status text;
  v_pkg_id uuid;
BEGIN
  -- Only intercept generate_exam_pool job inserts/updates entering active state
  IF NEW.job_type != 'package_generate_exam_pool' THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('pending','processing','queued') THEN
    RETURN NEW;
  END IF;

  v_pkg_id := NULLIF(NEW.payload->>'package_id', '')::uuid;
  IF v_pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check upstream causality
  SELECT status INTO v_seed_status
  FROM package_steps
  WHERE package_id = v_pkg_id AND step_key = 'auto_seed_exam_blueprints';

  SELECT status INTO v_validate_status
  FROM package_steps
  WHERE package_id = v_pkg_id AND step_key = 'validate_blueprints';

  -- If upstream is unsatisfied, defer instead of hot-loop
  IF (v_seed_status IS NOT NULL AND v_seed_status NOT IN ('done','skipped'))
     OR (v_validate_status IS NOT NULL AND v_validate_status NOT IN ('done','skipped')) THEN
    NEW.status := 'cancelled';
    NEW.last_error := format(
      'UPSTREAM_CAUSALITY_NOT_SATISFIED: auto_seed_exam_blueprints=%s, validate_blueprints=%s — deferred to avoid hot-loop',
      COALESCE(v_seed_status, 'missing'),
      COALESCE(v_validate_status, 'missing')
    );
    NEW.updated_at := now();

    INSERT INTO admin_actions (action, scope, affected_ids, payload)
    VALUES (
      'anti_hotloop_guard_blocked',
      'job',
      ARRAY[NEW.id::text],
      jsonb_build_object(
        'job_type', NEW.job_type,
        'package_id', v_pkg_id,
        'seed_status', v_seed_status,
        'validate_status', v_validate_status
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_generate_exam_pool_causality ON public.job_queue;
CREATE TRIGGER trg_guard_generate_exam_pool_causality
  BEFORE INSERT OR UPDATE OF status ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_generate_exam_pool_causality();

-- ─── 3. STALE-LOCK COUNTER FIX ──────────────────────────────
-- Recovery counter via meta.stale_lock_recoveries (NOT attempts, since
-- crashed runners never increment attempts → hard-kill never triggers).

CREATE OR REPLACE FUNCTION public.fn_release_stale_job_locks(p_lock_ttl_minutes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rec RECORD;
  v_released int := 0;
  v_killed int := 0;
  v_stale_interval interval;
  v_recovery_count int;
BEGIN
  FOR v_rec IN
    SELECT id, job_type, locked_at, last_heartbeat_at, meta, package_id
    FROM job_queue
    WHERE status = 'processing'
      AND locked_at IS NOT NULL
    ORDER BY locked_at ASC
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    v_stale_interval := CASE
      WHEN v_rec.job_type IN (
        'package_generate_exam_pool', 'package_generate_oral_exam',
        'package_generate_handbook', 'handbook_expand_section',
        'package_generate_learning_content', 'lesson_generate_content_shard',
        'package_generate_lesson_minichecks', 'package_generate_blueprint_variants'
      ) THEN interval '15 minutes'
      WHEN v_rec.job_type IN (
        'package_elite_harden', 'package_repair_exam_pool_quality',
        'package_build_ai_tutor_index', 'package_validate_blueprint_variants'
      ) THEN interval '10 minutes'
      ELSE interval '5 minutes'
    END;

    IF v_rec.locked_at >= now() - v_stale_interval THEN CONTINUE; END IF;
    IF v_rec.last_heartbeat_at IS NOT NULL
       AND v_rec.last_heartbeat_at >= now() - interval '3 minutes' THEN CONTINUE; END IF;

    -- Track recovery count in meta
    v_recovery_count := COALESCE((v_rec.meta->>'stale_lock_recoveries')::int, 0) + 1;

    IF v_recovery_count >= 5 THEN
      -- Hard-kill after 5 cycles
      UPDATE job_queue
      SET status = 'failed',
          locked_at = NULL,
          locked_by = NULL,
          last_error = format(
            'STALE_LOCK_LOOP_HARD_KILL: %s recovery cycles — runner repeatedly crashes before completing %s',
            v_recovery_count, v_rec.job_type
          ),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('stale_lock_recoveries', v_recovery_count, 'hard_killed_at', now()),
          updated_at = now()
      WHERE id = v_rec.id;

      INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
      VALUES (
        format('🔒 STALE_LOCK HARD KILL: %s', v_rec.job_type),
        format('Job %s nach %s STALE_LOCK_RECOVERY Zyklen terminiert. Package: %s',
          left(v_rec.id::text, 8), v_recovery_count, left(COALESCE(v_rec.package_id::text, 'n/a'), 8)),
        'ops', 'critical', 'job_queue', v_rec.id,
        jsonb_build_object('kind', 'stale_lock_hard_kill', 'job_type', v_rec.job_type,
                           'recovery_count', v_recovery_count, 'package_id', v_rec.package_id)
      );

      v_killed := v_killed + 1;
    ELSE
      UPDATE job_queue
      SET status = 'pending',
          locked_at = NULL,
          locked_by = NULL,
          last_error = format('STALE_LOCK_RECOVERY: lock held >%s min (cycle %s/5)',
            EXTRACT(EPOCH FROM v_stale_interval)::int/60, v_recovery_count),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('stale_lock_recoveries', v_recovery_count, 'last_recovery_at', now()),
          updated_at = now()
      WHERE id = v_rec.id;

      v_released := v_released + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'released', v_released,
    'hard_killed', v_killed,
    'ttl_mode', 'job_type_specific_with_meta_counter',
    'ran_at', now()
  );
END;
$$;
