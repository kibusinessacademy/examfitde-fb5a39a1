-- ════════════════════════════════════════════════════════════════════
-- ROOT-FIX Cancel-Storm: 991 Cancels in 6h
-- Forensik: fn_rebalance_wip_priority + nicht-attributierter Reverter
-- demotieren Pakete building→queued ohne Schutz für approved questions
-- oder aktive Tail-Jobs.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1) Helper: hat Paket genug Inhalt um vor Demotion geschützt zu sein? ───
CREATE OR REPLACE FUNCTION public.fn_package_demote_protected(p_pkg_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved int;
  v_progress int;
  v_pending_tail int;
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

  RETURN jsonb_build_object(
    'protected', v_approved >= 50 OR v_progress >= 70 OR v_pending_tail > 0,
    'approved_questions', v_approved,
    'build_progress', v_progress,
    'pending_tail_jobs', v_pending_tail
  );
END
$$;

REVOKE ALL ON FUNCTION public.fn_package_demote_protected(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_package_demote_protected(uuid) TO service_role;

-- ─── 2) Hard-Guard Trigger: blockiert building→queued für geschützte Pakete ───
CREATE OR REPLACE FUNCTION public.fn_guard_block_building_to_queued_revert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check jsonb;
  v_source text;
BEGIN
  -- nur building → queued
  IF NOT (OLD.status = 'building' AND NEW.status = 'queued') THEN
    RETURN NEW;
  END IF;

  -- Bypass: System-Replikation
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(current_setting('app.transition_source', true), 'unknown_trigger');

  -- Bypass: ausdrücklicher Admin-Wille
  IF v_source IN ('admin_manual', 'admin_soft_reset', 'admin_force_rebuild') THEN
    RETURN NEW;
  END IF;

  v_check := public.fn_package_demote_protected(NEW.id);

  IF (v_check->>'protected')::boolean THEN
    -- BLOCK: revertiert nicht, behält building bei
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, trigger_source,
       result_status, result_detail, metadata)
    VALUES (
      'guard_block_building_revert',
      'package',
      NEW.id::text,
      v_source,
      'blocked',
      format('Blocked building→queued revert (approved=%s progress=%s tail=%s)',
        v_check->>'approved_questions',
        v_check->>'build_progress',
        v_check->>'pending_tail_jobs'),
      jsonb_build_object(
        'protection', v_check,
        'transition_source', v_source,
        'attempted_at', now()
      )
    );

    -- erzwinge: status bleibt building, alle anderen Felder dürfen geändert werden
    NEW.status := 'building';
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_block_building_to_queued_revert ON public.course_packages;
CREATE TRIGGER trg_guard_block_building_to_queued_revert
BEFORE UPDATE OF status ON public.course_packages
FOR EACH ROW
WHEN (OLD.status = 'building' AND NEW.status = 'queued')
EXECUTE FUNCTION public.fn_guard_block_building_to_queued_revert();

-- ─── 3) fn_rebalance_wip_priority hardening ───
CREATE OR REPLACE FUNCTION public.fn_rebalance_wip_priority(p_max_demotions int DEFAULT 3)
RETURNS TABLE(
  demoted_package_id uuid,
  demoted_title text,
  demoted_priority int,
  freed_for_priority int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wip_cap INT;
  v_current_building INT;
  v_best_queued_priority INT;
  v_rec RECORD;
  v_min_progress_to_protect INT := 70;
  v_min_approved_to_protect INT := 50;
  v_finalization_steps TEXT[] := ARRAY['quality_council', 'run_integrity_check', 'auto_publish'];
  v_check jsonb;
BEGIN
  -- Identifiziere die Quelle für das Reverter-Audit
  PERFORM set_config('app.transition_source', 'wip_rebalancer', true);

  SELECT COALESCE(value::int, 14) INTO v_wip_cap
  FROM ops_pipeline_config WHERE key = 'wip_total_cap';

  SELECT count(*) INTO v_current_building
  FROM course_packages WHERE status = 'building';

  SELECT min(priority) INTO v_best_queued_priority
  FROM course_packages WHERE status = 'queued' AND priority IS NOT NULL;

  IF v_best_queued_priority IS NULL THEN RETURN; END IF;
  IF v_current_building < v_wip_cap THEN RETURN; END IF;

  FOR v_rec IN
    SELECT cp.id, c.title, cp.priority, cp.build_progress
    FROM course_packages cp
    JOIN courses c ON c.id = cp.course_id
    WHERE cp.status = 'building'
      AND cp.priority > v_best_queued_priority
      AND COALESCE(cp.build_progress, 0) < v_min_progress_to_protect
      -- NEU: approved-questions Schutz (≥50)
      AND (
        SELECT COUNT(*) FROM exam_questions eq
        WHERE eq.package_id = cp.id AND eq.status = 'approved'
      ) < v_min_approved_to_protect
      -- bestehender running-Tail-Schutz
      AND NOT EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key = ANY(v_finalization_steps)
          AND ps.status = 'running'
      )
      -- NEU: pending/queued Tail-Job Schutz
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = cp.id
          AND jq.status IN ('pending', 'queued', 'processing')
          AND jq.job_type IN (
            'package_quality_council',
            'package_run_integrity_check',
            'package_auto_publish'
          )
      )
    ORDER BY cp.priority DESC, cp.build_progress ASC, cp.updated_at ASC
    LIMIT p_max_demotions
  LOOP
    -- defensive double-check via Helper (race-safe)
    v_check := public.fn_package_demote_protected(v_rec.id);
    IF (v_check->>'protected')::boolean THEN
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
      VALUES (
        'wip_rebalance_skipped_protected',
        'package',
        v_rec.id::text,
        'wip_rebalancer',
        'skipped',
        'Skipped demotion: package protected by approved questions or tail jobs',
        v_check
      );
      CONTINUE;
    END IF;

    UPDATE job_queue SET status = 'cancelled',
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'WIP_REBALANCE_DEMOTION',
        'cancelled_by', 'wip_rebalancer',
        'cancelled_at', now()
      ),
      updated_at = now()
    WHERE package_id = v_rec.id AND status = 'pending';

    UPDATE course_packages SET status = 'queued', updated_at = now()
    WHERE id = v_rec.id;

    INSERT INTO admin_actions (action, scope, affected_ids, payload)
    VALUES ('wip_priority_rebalance', 'pipeline', ARRAY[v_rec.id::text],
        jsonb_build_object(
            'demoted_package', v_rec.id, 'demoted_title', v_rec.title,
            'demoted_priority', v_rec.priority, 'demoted_progress', v_rec.build_progress,
            'best_queued_priority', v_best_queued_priority,
            'wip_before', v_current_building, 'wip_cap', v_wip_cap,
            'version', 'v3_approved_q_protected'
        ));

    v_current_building := v_current_building - 1;

    demoted_package_id := v_rec.id;
    demoted_title := v_rec.title;
    demoted_priority := v_rec.priority;
    freed_for_priority := v_best_queued_priority;
    RETURN NEXT;

    IF v_current_building < v_wip_cap THEN EXIT; END IF;
  END LOOP;
  RETURN;
END
$$;