
-- ============================================================================
-- Pipeline Loop Hardening v2: block-aware producers + source contract
-- ============================================================================

-- 1) fn_heal_orphan_queued_steps: block-aware + enqueue_source tagged
CREATE OR REPLACE FUNCTION public.fn_heal_orphan_queued_steps(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_healed int := 0;
  v_skipped int := 0;
  v_pending int := 0;
  v_blocked int := 0;
  v_job_type text;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
BEGIN
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.id AS step_id, cp.curriculum_id, cp.status::text AS pkg_status,
           COALESCE((ps.meta->>'last_enqueue_attempt')::timestamptz, 'epoch'::timestamptz) AS last_attempt
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'::step_status
      AND cp.status::text IN ('building','quality_gate_failed','blocked','planning','queued')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.payload->>'step_key' = ps.step_key
          AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled')
      )
    ORDER BY ps.updated_at ASC
    LIMIT p_limit
  LOOP
    -- ── Block-aware skip ──
    IF public.fn_is_package_progress_blocked(v_rec.package_id) THEN
      v_blocked := v_blocked + 1;
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('producer_blocked_package_progress','fn_heal_orphan_queued_steps','package',
              v_rec.package_id::text,'skipped',
              jsonb_build_object(
                'producer','fn_heal_orphan_queued_steps',
                'reason','package_progress_blocked',
                'bronze_locked', public.fn_is_bronze_locked(v_rec.package_id),
                'step_key', v_rec.step_key));
      CONTINUE;
    END IF;

    IF v_rec.last_attempt > now() - interval '5 minutes' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    SELECT sjm.job_types[1] INTO v_job_type
    FROM step_job_mapping sjm
    WHERE sjm.step_key = v_rec.step_key AND array_length(sjm.job_types, 1) > 0;
    IF v_job_type IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM step_dag_edges dag
      JOIN package_steps dep ON dep.package_id = v_rec.package_id AND dep.step_key = dag.depends_on
      WHERE dag.step_key = v_rec.step_key AND dep.status NOT IN ('done'::step_status,'skipped'::step_status)
    ) INTO v_has_unmet_deps;
    IF v_has_unmet_deps THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    BEGIN
      SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
        v_job_type, v_rec.package_id, 0, 3, now(),
        jsonb_build_object(
          'package_id', v_rec.package_id,
          'curriculum_id', v_rec.curriculum_id,
          'step_key', v_rec.step_key,
          'enqueue_source','orphan_queued_heal')
      );
      IF v_enqueue_result.created THEN
        v_healed := v_healed + 1;
        UPDATE package_steps
        SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('last_enqueue_attempt', now())
        WHERE id = v_rec.step_id;
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('orphan_queued_heal','fn_heal_orphan_queued_steps','package_step',v_rec.package_id::text,'enqueued',
                'Healed orphan queued step '||v_rec.step_key,
                jsonb_build_object('package_id',v_rec.package_id,'step_key',v_rec.step_key,'job_type',v_job_type,'enqueue_source','orphan_queued_heal'));
      ELSE
        v_pending := v_pending + 1;
        UPDATE package_steps
        SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
              'last_enqueue_attempt', now(),
              'last_enqueue_reject_reason', COALESCE(v_enqueue_result.status,'enqueue_rejected')
            )
        WHERE id = v_rec.step_id;
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('orphan_queued_dedup_cooldown','fn_heal_orphan_queued_steps','package_step',v_rec.package_id::text,'cooldown',
                'Enqueue rejected, keeping step queued with 5min cooldown',
                jsonb_build_object('package_id',v_rec.package_id,'step_key',v_rec.step_key,'reason',COALESCE(v_enqueue_result.status,'enqueue_rejected')));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO admin_actions(action, scope, payload)
  VALUES ('orphan_queued_heal_run','system',
          jsonb_build_object('healed',v_healed,'cooldown_skipped',v_pending,'skipped',v_skipped,'blocked',v_blocked,'limit',p_limit,'ran_at',now()));

  RETURN jsonb_build_object('ok',true,'healed',v_healed,'cooldown',v_pending,'skipped',v_skipped,'blocked',v_blocked);
END;
$function$;

-- 2) fn_materialize_ready_step_jobs: block-aware + enqueue_source tagged
CREATE OR REPLACE FUNCTION public.fn_materialize_ready_step_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_zombies integer := 0;
  v_should_run boolean;
  v_blocked integer := 0;
  rec record;
BEGIN
  UPDATE job_queue
  SET started_at = NULL, locked_at = NULL, locked_by = NULL
  WHERE status = 'pending' AND started_at IS NOT NULL;
  GET DIAGNOSTICS v_zombies = ROW_COUNT;
  IF v_zombies > 0 THEN
    RAISE LOG '[materializer] Cleaned % zombie jobs', v_zombies;
  END IF;

  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id, c.id as course_id, cp.track
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.curriculum_id = cp.curriculum_id
    WHERE cp.status = 'building'
      AND ps.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps dep ON dep.package_id = ps.package_id AND dep.step_key = dag.depends_on
        WHERE dag.step_key = ps.step_key AND dep.status NOT IN ('done', 'skipped')
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status IN ('pending', 'processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status = 'completed'
        AND jq.completed_at > now() - interval '2 minutes'
      )
  LOOP
    -- ── Block-aware skip ──
    IF public.fn_is_package_progress_blocked(rec.package_id) THEN
      v_blocked := v_blocked + 1;
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES ('producer_blocked_package_progress','fn_materialize_ready_step_jobs','package',
              rec.package_id::text,'skipped',
              jsonb_build_object(
                'producer','fn_materialize_ready_step_jobs',
                'reason','package_progress_blocked',
                'bronze_locked', public.fn_is_bronze_locked(rec.package_id),
                'step_key', rec.step_key));
      CONTINUE;
    END IF;

    v_should_run := true;
    IF rec.track IS NOT NULL THEN
      SELECT tsa.should_run INTO v_should_run
      FROM track_step_applicability tsa
      WHERE tsa.track = rec.track::product_track
        AND tsa.step_key = rec.step_key;
      IF v_should_run IS NULL THEN v_should_run := true; END IF;
    END IF;

    IF NOT v_should_run THEN
      UPDATE package_steps
      SET status = 'skipped', updated_at = now(),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'skip_reason', 'track_not_applicable',
            'skipped_by', 'fn_materialize_ready_step_jobs',
            'track', rec.track)
      WHERE package_id = rec.package_id AND step_key = rec.step_key AND status = 'queued';
      INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('ssot_applicability_skip', 'fn_materialize_ready_step_jobs', 'package_step', rec.package_id::text, 'corrected',
              'Auto-skipped non-applicable step ' || rec.step_key || ' for track ' || rec.track,
              jsonb_build_object('package_id', rec.package_id, 'step_key', rec.step_key, 'track', rec.track));
      CONTINUE;
    END IF;

    INSERT INTO job_queue (job_type, package_id, payload, priority, status, created_at)
    VALUES (
      'package_' || rec.step_key,
      rec.package_id,
      jsonb_build_object(
        'package_id', rec.package_id,
        'curriculum_id', rec.curriculum_id,
        'course_id', rec.course_id,
        'triggered_by', 'auto_materializer',
        'enqueue_source', 'ready_materializer'
      ),
      10, 'pending', now()
    )
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_blocked > 0 THEN
    RAISE LOG '[materializer] Skipped % blocked packages', v_blocked;
  END IF;
  RETURN v_count;
END;
$function$;

-- 3) auto_ops_cycle: block-aware retry/rescue + enqueue_source tagged
CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_depth_heal jsonb;
  v_count int;
  v_blocked int := 0;
BEGIN
  BEGIN
    v_count := fn_materialize_ready_step_jobs();
    v_result := v_result || jsonb_build_object('jobs_materialized', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('materialize_error', SQLERRM);
  END;

  BEGIN
    v_count := auto_link_certification_documents();
    v_result := v_result || jsonb_build_object('depth_linked', v_count);
    v_count := auto_seed_curriculum_topics();
    v_result := v_result || jsonb_build_object('depth_seeded', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('depth_error', SQLERRM);
  END;

  BEGIN
    v_depth_heal := auto_heal_shallow_content();
    v_result := v_result || jsonb_build_object('depth_heal', v_depth_heal);
  EXCEPTION WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('depth_heal_error', SQLERRM);
  END;

  -- ── RETRY failed jobs (block-aware + tagged) ──
  BEGIN
    WITH retryable AS (
      SELECT jq.id, jq.package_id
      FROM job_queue jq
      WHERE jq.status = 'failed'
        AND jq.attempts < jq.max_attempts
        AND jq.created_at > now() - interval '7 days'
        AND COALESCE((jq.result->>'permanent')::boolean, false) = false
        AND COALESCE(jq.last_error, '') NOT ILIKE '%"last_error_class":"permanent"%'
        AND COALESCE(jq.last_error, '') NOT ILIKE '%SSOT_GUARD%'
        AND COALESCE(jq.last_error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
        AND COALESCE(jq.error, '') NOT ILIKE '%SSOT_GUARD%'
        AND COALESCE(jq.error, '') NOT ILIKE '%HTTP 422 PERMANENT%'
        AND COALESCE(jq.last_error, '') NOT ILIKE '%HARD_FAIL%'
        AND COALESCE(jq.last_error, '') NOT ILIKE '%HARD_FAIL_BREAKER%'
        AND COALESCE(jq.last_error, '') NOT ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
        AND COALESCE(jq.last_error, '') NOT ILIKE '%terminal_escalation%'
        AND COALESCE(jq.error, '') NOT ILIKE '%HARD_FAIL%'
        AND COALESCE((jq.meta->>'terminal_escalation')::boolean, false) = false
        AND (jq.package_id IS NULL OR NOT public.fn_is_package_progress_blocked(jq.package_id))
      ORDER BY jq.updated_at DESC
      LIMIT 20
    )
    UPDATE job_queue
    SET status = 'pending',
        run_after = now() + interval '30 seconds',
        updated_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('enqueue_source','auto_ops_cycle_retry')
    WHERE id IN (SELECT id FROM retryable);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('jobs_retried', v_count);

    -- audit blocked retries
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
    SELECT 'producer_blocked_package_progress','auto_ops_cycle','package',jq.package_id::text,'skipped',
           jsonb_build_object('producer','auto_ops_cycle_retry','reason','package_progress_blocked',
             'bronze_locked', public.fn_is_bronze_locked(jq.package_id),'job_id',jq.id)
    FROM job_queue jq
    WHERE jq.status = 'failed'
      AND jq.package_id IS NOT NULL
      AND public.fn_is_package_progress_blocked(jq.package_id)
      AND jq.updated_at > now() - interval '5 minutes'
    LIMIT 20;
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('retry_error', SQLERRM);
  END;

  -- ── RESCUE stuck processing (block-aware + tagged) ──
  BEGIN
    WITH stuck AS (
      SELECT jq.id FROM job_queue jq
      WHERE jq.status = 'processing'
        AND jq.started_at < now() - interval '15 minutes'
        AND (jq.package_id IS NULL OR NOT public.fn_is_package_progress_blocked(jq.package_id))
      LIMIT 10
    )
    UPDATE job_queue
    SET status = 'pending',
        run_after = now() + interval '1 minute',
        updated_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('enqueue_source','auto_ops_cycle_rescue')
    WHERE id IN (SELECT id FROM stuck);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('stuck_rescued', v_count);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('stuck_error', SQLERRM);
  END;

  BEGIN
    DELETE FROM pipeline_lock WHERE locked_at < now() - interval '30 minutes';
    DELETE FROM course_generation_locks WHERE locked_at < now() - interval '30 minutes';
    v_result := v_result || jsonb_build_object('locks_cleaned', true);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('locks_error', SQLERRM);
  END;

  RETURN v_result;
END;
$function$;

-- 4) Bronze-Guard: Cluster untagged producer separat
CREATE OR REPLACE FUNCTION public.fn_guard_bronze_lock_on_job_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_locked boolean; v_source text; v_pkg_id uuid;
  v_app text; v_pid int; v_query text;
  v_payload_keys jsonb;
  v_action text;
BEGIN
  IF NEW.job_type NOT IN ('package_quality_council','package_auto_publish','package_run_integrity_check') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IN ('queued','pending','processing') AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('queued','pending','processing') THEN RETURN NEW; END IF;
  v_pkg_id := COALESCE(NEW.package_id, NULLIF(NEW.payload->>'package_id','')::uuid);
  IF v_pkg_id IS NULL THEN RETURN NEW; END IF;
  SELECT public.fn_is_bronze_locked(v_pkg_id) INTO v_locked;
  IF NOT v_locked THEN RETURN NEW; END IF;
  v_source := COALESCE(
    NEW.payload->>'enqueue_source', NEW.meta->>'enqueue_source',
    NEW.meta->>'source', NEW.payload->>'source',
    NEW.payload->>'_origin', NEW.payload->>'mode', 'unknown');
  IF v_source = 'bronze_targeted_repair' THEN RETURN NEW; END IF;
  IF (NEW.payload->>'bronze_lock_override')::boolean = true THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_lock_admin_override',
            v_pkg_id::text,'package','success',
            format('Admin override: %s', NEW.job_type),
            jsonb_build_object('package_id', v_pkg_id, 'job_type', NEW.job_type, 'enqueue_source', v_source));
    RETURN NEW;
  END IF;

  SELECT application_name, pid, left(query, 500)
    INTO v_app, v_pid, v_query
  FROM pg_stat_activity WHERE pid = pg_backend_pid();

  v_payload_keys := (
    SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
    FROM jsonb_object_keys(COALESCE(NEW.payload, '{}'::jsonb)) AS k
  );

  v_action := CASE WHEN v_source = 'unknown'
                   THEN 'producer_source_missing_blocked'
                   ELSE 'bronze_locked_enqueue_blocked' END;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('fn_guard_bronze_lock_on_job_enqueue', v_action,
          v_pkg_id::text,'package','skipped',
          format('Bronze lock — %s rejected (source=%s)', NEW.job_type, v_source),
          jsonb_build_object(
            'package_id', v_pkg_id,
            'job_type', NEW.job_type,
            'enqueue_source', v_source,
            'tg_op', TG_OP,
            'skipped_reason', CASE WHEN v_source='unknown' THEN 'PRODUCER_SOURCE_MISSING' ELSE 'BRONZE_LOCKED_REQUIRES_REVIEW' END,
            'application_name', v_app,
            'backend_pid', v_pid,
            'caller_query', v_query,
            'payload_keys', v_payload_keys,
            'meta_keys', (
              SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
              FROM jsonb_object_keys(COALESCE(NEW.meta, '{}'::jsonb)) AS k
            ),
            'created_by','bronze_blocked_producer_tracker_v2'
          ));
  IF TG_OP = 'INSERT' THEN
    RETURN NULL;
  ELSE
    NEW.status := 'cancelled';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.last_error := CASE WHEN v_source='unknown' THEN 'PRODUCER_SOURCE_MISSING' ELSE 'BRONZE_LOCKED_REQUIRES_REVIEW' END;
    NEW.result := COALESCE(NEW.result, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by','bronze_lock_guard',
      'reason', NEW.last_error,
      'enqueue_source', v_source);
    RETURN NEW;
  END IF;
END;
$function$;
