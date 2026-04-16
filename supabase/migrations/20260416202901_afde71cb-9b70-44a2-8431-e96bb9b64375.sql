-- Fix #3 v2: Schemafest gegen v3 integrity_report (number-score) + Quality-Fail-Recovery
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
  v_quality_failed int := 0;
  v_stale_interval interval;
  v_recovery_count int;
  v_score numeric;
BEGIN
  FOR v_rec IN
    SELECT j.id, j.job_type, j.locked_at, j.started_at, j.last_heartbeat_at, j.meta, j.package_id,
           p.integrity_report,
           p.integrity_report IS NOT NULL AS has_integrity_report,
           p.integrity_report_version_num AS integrity_version_num,
           p.integrity_report->>'gate_version' AS gate_version,
           p.integrity_passed,
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

    -- ── Fix #3 v2: Artifact-Aware Recovery für package_run_integrity_check ──
    -- Schemafest: akzeptiert sowohl version_num als auch gate_version als Evidenz.
    -- Score-Lesen tolerant für number- und object-Schema.
    IF v_rec.job_type = 'package_run_integrity_check'
       AND v_rec.has_integrity_report
       AND (v_rec.integrity_version_num IS NOT NULL OR v_rec.gate_version IS NOT NULL)
       AND v_rec.pkg_updated_at IS NOT NULL
       AND v_rec.started_at IS NOT NULL
       AND v_rec.pkg_updated_at > v_rec.started_at
    THEN
      -- Score schemafest extrahieren (v3=number, alt=object.overall)
      v_score := CASE
        WHEN jsonb_typeof(v_rec.integrity_report->'score') = 'number'
          THEN (v_rec.integrity_report->>'score')::numeric
        WHEN jsonb_typeof(v_rec.integrity_report->'score') = 'object'
          THEN COALESCE((v_rec.integrity_report->'score'->>'overall')::numeric, NULL)
        ELSE NULL
      END;

      -- Pfad A: integrity_passed=true → completed
      IF v_rec.integrity_passed IS TRUE THEN
        UPDATE job_queue
        SET status = 'completed',
            locked_at = NULL,
            locked_by = NULL,
            completed_at = COALESCE(completed_at, now()),
            last_error = NULL,
            result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
              'ok', true, 'executed', true,
              'integrity_score', v_score, 'gate_version', v_rec.gate_version,
              'integrity_version', v_rec.integrity_version_num
            ),
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'completed_via_artifact_recovery', true,
              'artifact_recovery_at', now(),
              'artifact_version', v_rec.integrity_version_num,
              'gate_version', v_rec.gate_version,
              'recovery_reason', 'integrity_passed=true; report freshly materialized; runner failed to persist'
            ),
            updated_at = now()
        WHERE id = v_rec.id;
        v_artifact_completed := v_artifact_completed + 1;
        CONTINUE;
      END IF;

      -- Pfad B: integrity_passed=false → failed/QUALITY_THRESHOLD_NOT_MET
      -- (Edge-Function lief erfolgreich, Ergebnis ist fachlicher Fail, keine Runtime-Frage)
      UPDATE job_queue
      SET status = 'failed',
          locked_at = NULL,
          locked_by = NULL,
          completed_at = COALESCE(completed_at, now()),
          last_error = format('QUALITY_THRESHOLD_NOT_MET: integrity_score=%s (gate=%s, v=%s)',
                              COALESCE(v_score::text, 'n/a'),
                              COALESCE(v_rec.gate_version, 'n/a'),
                              COALESCE(v_rec.integrity_version_num::text, 'n/a')),
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'ok', false, 'executed', true,
            'integrity_score', v_score, 'gate_version', v_rec.gate_version,
            'integrity_version', v_rec.integrity_version_num
          ),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'reclassified_via_artifact_recovery', true,
            'reclassified_at', now(),
            'quality_fail', true,
            'recovery_reason', 'integrity_passed=false; runtime success but quality threshold not met'
          ),
          updated_at = now()
      WHERE id = v_rec.id;
      v_quality_failed := v_quality_failed + 1;
      CONTINUE;
    END IF;

    -- Standard recovery path (unchanged)
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
    'quality_failed', v_quality_failed,
    'ttl_mode', 'job_type_specific_with_artifact_aware_completion_v2_schema_safe',
    'ran_at', now()
  );
END;
$function$;