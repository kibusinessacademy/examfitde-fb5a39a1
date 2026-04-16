-- ════════════════════════════════════════════════════════════════════════
-- Fix #3: Artifact-Aware Stale-Lock Recovery für package_run_integrity_check
-- ════════════════════════════════════════════════════════════════════════
-- Problem: Edge-Function vollendet Arbeit (integrity_report wird geschrieben),
-- aber Job-Runner crasht durch Tick-Capacity-Overflow bevor er status=completed setzt.
-- 
-- Lösung: Wenn das Artefakt nachweislich FRISCHER als der Job-Lauf ist,
-- darf Recovery den Job direkt auf 'completed' setzen statt erneut zu requeuen.
-- Schutz: Nur wenn course_packages.updated_at > job.started_at — sonst könnte
-- ein alter Report einen kaputten neuen Lauf fälschlich grün färben.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_release_stale_job_locks(p_lock_ttl_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_released int := 0;
  v_killed int := 0;
  v_artifact_completed int := 0;
  v_stale_interval interval;
  v_recovery_count int;
  v_artifact_fresh boolean;
BEGIN
  FOR v_rec IN
    SELECT j.id, j.job_type, j.locked_at, j.started_at, j.last_heartbeat_at, j.meta, j.package_id,
           p.integrity_report IS NOT NULL AS has_integrity_report,
           p.integrity_report_version_num AS integrity_version,
           p.updated_at AS pkg_updated_at
    FROM job_queue j
    LEFT JOIN course_packages p ON p.id = j.package_id
    WHERE j.status = 'processing'
      AND j.locked_at IS NOT NULL
    ORDER BY j.locked_at ASC
    LIMIT 200
    FOR UPDATE OF j SKIP LOCKED
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

    -- ── Fix #3: Artifact-Aware Completion-Detection ──
    -- Nur für package_run_integrity_check: Wenn das Artefakt (integrity_report)
    -- FRISCHER ist als der Job-Lauf (started_at), dann hat die Edge-Function
    -- erfolgreich materialisiert und nur der Runner ist gecrasht.
    -- → Direkt auf completed setzen, NICHT erneut requeuen.
    IF v_rec.job_type = 'package_run_integrity_check'
       AND v_rec.has_integrity_report
       AND v_rec.integrity_version IS NOT NULL
       AND v_rec.pkg_updated_at IS NOT NULL
       AND v_rec.started_at IS NOT NULL
       AND v_rec.pkg_updated_at > v_rec.started_at
    THEN
      UPDATE job_queue
      SET status = 'completed',
          locked_at = NULL,
          locked_by = NULL,
          completed_at = COALESCE(completed_at, now()),
          last_error = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'completed_via_artifact_recovery', true,
            'artifact_recovery_at', now(),
            'artifact_version', v_rec.integrity_version,
            'artifact_updated_at', v_rec.pkg_updated_at,
            'recovery_reason', 'integrity_report freshly materialized after job started but runner failed to persist completion'
          ),
          updated_at = now()
      WHERE id = v_rec.id;

      INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
      VALUES (
        format('✅ Artifact-Recovery: %s', v_rec.job_type),
        format('Job %s auf completed gesetzt — integrity_report v%s wurde nachweislich materialisiert (pkg updated: %s, job started: %s). Runner-Persistenz fehlgeschlagen, Selbstheilung greift.',
          left(v_rec.id::text, 8), v_rec.integrity_version,
          to_char(v_rec.pkg_updated_at, 'HH24:MI:SS'),
          to_char(v_rec.started_at, 'HH24:MI:SS')),
        'ops', 'info', 'job_queue', v_rec.id,
        jsonb_build_object('kind', 'artifact_aware_completion', 'job_type', v_rec.job_type,
                           'package_id', v_rec.package_id, 'artifact_version', v_rec.integrity_version)
      );

      v_artifact_completed := v_artifact_completed + 1;
      CONTINUE;
    END IF;

    -- Standard recovery path
    v_recovery_count := COALESCE((v_rec.meta->>'stale_lock_recoveries')::int, 0) + 1;

    IF v_recovery_count >= 5 THEN
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
    'artifact_completed', v_artifact_completed,
    'ttl_mode', 'job_type_specific_with_artifact_aware_completion',
    'ran_at', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_release_stale_job_locks(integer) IS
'Stale-lock recovery with artifact-aware completion (Fix #3): For package_run_integrity_check, if integrity_report was materialized AFTER job started, mark completed directly instead of requeuing. Prevents Tick-Capacity-Overflow ghost-recovery loops.';