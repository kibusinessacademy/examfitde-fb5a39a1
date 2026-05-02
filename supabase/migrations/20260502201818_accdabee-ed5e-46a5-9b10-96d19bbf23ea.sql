-- ============================================================================
-- 1. fn_rebalance_wip_priority: build_progress=100 hart schützen (Edge-Case)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_package_demote_protected(p_pkg_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_approved int;
  v_progress int;
  v_pending_tail int;
  v_protected boolean;
BEGIN
  SELECT COUNT(*) INTO v_approved
    FROM exam_questions
    WHERE package_id = p_pkg_id AND status = 'approved';

  SELECT COALESCE(build_progress, 0) INTO v_progress
    FROM course_packages WHERE id = p_pkg_id;

  SELECT COUNT(*) INTO v_pending_tail
    FROM job_queue
    WHERE package_id = p_pkg_id
      AND status IN ('pending', 'queued', 'processing')
      AND job_type IN (
        'package_quality_council',
        'package_run_integrity_check',
        'package_auto_publish',
        'package_repair_exam_pool_quality',
        'package_validate_exam_pool',
        'package_validate_blueprint_variants',
        'package_promote_blueprint_variants',
        'package_validate_oral_exam',
        'package_generate_oral_exam',
        'package_build_ai_tutor_index',
        'package_validate_tutor_index',
        'package_elite_harden'
      );

  -- v2: build_progress=100 ist IMMER geschützt (Publish-readiness erreicht)
  v_protected := v_progress >= 100
              OR v_approved >= 50
              OR v_progress >= 70
              OR v_pending_tail > 0;

  RETURN jsonb_build_object(
    'protected', v_protected,
    'approved_questions', v_approved,
    'build_progress', v_progress,
    'pending_tail_jobs', v_pending_tail,
    'reason', CASE
      WHEN v_progress >= 100 THEN 'build_complete_100'
      WHEN v_approved >= 50 THEN 'approved_questions_threshold'
      WHEN v_progress >= 70 THEN 'build_progress_threshold'
      WHEN v_pending_tail > 0 THEN 'pending_tail_jobs'
      ELSE 'unprotected'
    END
  );
END
$function$;

-- ============================================================================
-- 2. auto_heal_building_zombies: Demote-Schutz + Identity-Tag
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_heal_building_zombies(zombie_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  healed integer := 0;
BEGIN
  -- Identity attribution für Hard-Guard und Audit
  PERFORM set_config('app.transition_source', 'auto_heal_building_zombies', true);

  WITH candidates AS (
    SELECT cp.id
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND cp.updated_at < now() - (zombie_minutes || ' minutes')::interval
      AND NOT EXISTS (
        SELECT 1 FROM package_leases pl
        WHERE pl.package_id = cp.id AND pl.lease_until > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.status IN ('pending', 'processing')
      )
      -- v2: explizit publish-unreife
      AND NOT (public.fn_package_demote_protected(cp.id)->>'protected')::boolean
  ),
  updated AS (
    UPDATE course_packages
    SET status = 'queued',
        last_error = 'auto_heal: building zombie reset after ' || zombie_minutes || ' min without lease/jobs',
        updated_at = now()
    WHERE id IN (SELECT id FROM candidates)
    RETURNING id
  )
  SELECT count(*) INTO healed FROM updated;

  -- Audit für übersprungene (geschützte) Zombies
  INSERT INTO public.auto_heal_log
    (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  SELECT 'auto_heal_zombie_skipped_protected',
         'auto_heal_building_zombies',
         'package',
         cp.id::text,
         'skipped',
         'Zombie heal skipped: package protected',
         public.fn_package_demote_protected(cp.id)
  FROM course_packages cp
  WHERE cp.status = 'building'
    AND cp.updated_at < now() - (zombie_minutes || ' minutes')::interval
    AND NOT EXISTS (SELECT 1 FROM package_leases pl WHERE pl.package_id = cp.id AND pl.lease_until > now())
    AND NOT EXISTS (SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','processing'))
    AND (public.fn_package_demote_protected(cp.id)->>'protected')::boolean;

  -- Reset hängender steps nur für tatsächlich gehealte Zombies
  UPDATE package_steps ps
  SET status = 'queued',
      job_id = NULL,
      runner_id = NULL,
      started_at = NULL,
      last_error = 'auto_heal: zombie building reset'
  WHERE ps.package_id IN (
    SELECT cp.id FROM course_packages cp
    WHERE cp.status = 'queued'
      AND cp.last_error LIKE 'auto_heal: building zombie%'
      AND cp.updated_at > now() - interval '1 minute'
  )
  AND ps.status = 'running';

  RETURN healed;
END;
$function$;

-- ============================================================================
-- 3. enforce_priority_gate: Identity-Tag + Demote-Schutz
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_priority_gate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ceiling integer;
  v_demoted integer := 0;
BEGIN
  PERFORM set_config('app.transition_source', 'enforce_priority_gate', true);

  v_ceiling := get_priority_ceiling();
  
  IF v_ceiling < 100 THEN
    UPDATE course_packages
    SET status = 'queued', current_step = 0, updated_at = now()
    WHERE status = 'building'
      AND priority > v_ceiling
      AND build_progress < 10
      AND updated_at < now() - interval '10 minutes'
      AND NOT (public.fn_package_demote_protected(id)->>'protected')::boolean
      AND id NOT IN (
        SELECT target_id::uuid FROM auto_heal_log
        WHERE action_type = 'recover_and_reenter_package'
          AND result_status = 'success'
          AND created_at > now() - interval '15 minutes'
      );
    
    GET DIAGNOSTICS v_demoted = ROW_COUNT;
    
    IF v_demoted > 0 THEN
      UPDATE job_queue
      SET status = 'cancelled',
          last_error = 'enforce_priority_gate: package demoted (priority > ceiling ' || v_ceiling || ')',
          completed_at = now()
      WHERE status IN ('pending', 'processing')
        AND package_id IN (
          SELECT id FROM course_packages
          WHERE status = 'queued' AND current_step = 0
            AND updated_at > now() - interval '1 minute'
        );
        
      INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, metadata)
      VALUES ('enforce_priority_gate', 'cron', 'applied',
        v_demoted || ' packages demoted (ceiling=' || v_ceiling || ')',
        jsonb_build_object('ceiling', v_ceiling, 'demoted', v_demoted));
    END IF;
  END IF;
END;
$function$;

-- ============================================================================
-- 4. Re-Enqueue Rate-Limit Trigger: max 3 building→queued reverts / pkg / 6h
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_guard_revert_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recent_reverts int;
  v_source text;
  v_max_reverts int := 3;
  v_window interval := interval '6 hours';
BEGIN
  -- Nur building → queued
  IF NOT (OLD.status = 'building' AND NEW.status = 'queued') THEN
    RETURN NEW;
  END IF;

  -- System-Replikation bypass
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(current_setting('app.transition_source', true), 'unknown_trigger');

  -- Admin-Bypass
  IF v_source IN ('admin_manual', 'admin_soft_reset', 'admin_force_rebuild') THEN
    RETURN NEW;
  END IF;

  -- Zähle Reverts in Window aus Detector-Log (canonical source)
  SELECT COUNT(*) INTO v_recent_reverts
  FROM public.auto_heal_log
  WHERE action_type = 'PATTERN_X6_STATUS_REVERTER'
    AND target_id = NEW.id::text
    AND created_at > now() - v_window;

  IF v_recent_reverts >= v_max_reverts THEN
    -- Hartes Backoff: revert blockieren, Audit
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
    VALUES (
      'guard_block_revert_rate_limit',
      'package',
      NEW.id::text,
      v_source,
      'blocked',
      format('Backoff: %s reverts in last %s exceeds cap=%s', v_recent_reverts, v_window, v_max_reverts),
      jsonb_build_object(
        'recent_reverts', v_recent_reverts,
        'window', v_window::text,
        'cap', v_max_reverts,
        'transition_source', v_source,
        'attempted_at', now()
      )
    );

    NEW.status := 'building';
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$function$;

-- Trigger anlegen (BEFORE UPDATE, läuft VOR fn_guard_block_building_to_queued_revert ist OK,
-- da beide BEFORE-Trigger sind und alphabetisch nach Name sortiert werden;
-- 'a_' Präfix nicht nötig, beide schreiben identisch NEW.status:='building')
DROP TRIGGER IF EXISTS trg_guard_revert_rate_limit ON public.course_packages;
CREATE TRIGGER trg_guard_revert_rate_limit
  BEFORE UPDATE OF status ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_revert_rate_limit();

COMMENT ON TRIGGER trg_guard_revert_rate_limit ON public.course_packages IS
  'Cancel-Storm v2: blockt mehr als 3 building→queued reverts pro Paket innerhalb 6h. Bypass via app.transition_source IN (admin_*) oder session_replication_role=replica.';

COMMENT ON FUNCTION public.fn_guard_revert_rate_limit IS
  'Rate-Limit für DAG-Predecessor-Rollback-Schleifen. Stützt sich auf PATTERN_X6_STATUS_REVERTER Audit als canonical revert log.';