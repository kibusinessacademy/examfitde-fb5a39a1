-- Bronze-Pre-Filter Phase 2: orphan_reconciler + trg_atomic_enqueue
-- Bronze-locked Pakete dürfen kein Council/AutoPublish enqueuen
-- → Skip vor INSERT, Audit mit 1h Cooldown pro (package_id, job_type, source)

-- ============================================================
-- 1) fn_reconcile_orphan_steps: Bronze-Pre-Filter pro Step
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_reconcile_orphan_steps()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reconciled int := 0;
  v_checked int := 0;
  v_blocked_inflight int := 0;
  v_blocked_cooldown int := 0;
  v_blocked_fanout int := 0;
  v_blocked_too_young int := 0;
  v_blocked_unknown_step int := 0;
  v_blocked_dag int := 0;
  v_blocked_bronze int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  v_step_dist jsonb := '{}'::jsonb;
  rec record;
  v_job_type text;
  v_pool text;
  v_dag_ok boolean;
  v_recent_audit boolean;
  v_step_jobs jsonb := '{
    "scaffold_learning_course": "package_scaffold_learning_course",
    "generate_glossary": "package_generate_glossary",
    "fanout_learning_content": "package_fanout_learning_content",
    "generate_learning_content": "package_generate_learning_content",
    "finalize_learning_content": "package_finalize_learning_content",
    "validate_learning_content": "package_validate_learning_content",
    "auto_seed_exam_blueprints": "package_auto_seed_exam_blueprints",
    "validate_blueprints": "package_validate_blueprints",
    "generate_blueprint_variants": "package_generate_blueprint_variants",
    "validate_blueprint_variants": "package_validate_blueprint_variants",
    "promote_blueprint_variants": "package_promote_blueprint_variants",
    "generate_exam_pool": "package_generate_exam_pool",
    "validate_exam_pool": "package_validate_exam_pool",
    "repair_exam_pool_quality": "package_repair_exam_pool_quality",
    "build_ai_tutor_index": "package_build_ai_tutor_index",
    "validate_tutor_index": "package_validate_tutor_index",
    "generate_oral_exam": "package_generate_oral_exam",
    "validate_oral_exam": "package_validate_oral_exam",
    "generate_lesson_minichecks": "package_generate_lesson_minichecks",
    "validate_lesson_minichecks": "package_validate_lesson_minichecks",
    "generate_handbook": "package_generate_handbook",
    "validate_handbook": "package_validate_handbook",
    "enqueue_handbook_expand": "package_enqueue_handbook_expand",
    "expand_handbook": "handbook_expand_section",
    "validate_handbook_depth": "package_validate_handbook_depth",
    "elite_harden": "package_elite_harden",
    "run_integrity_check": "package_run_integrity_check",
    "quality_council": "package_quality_council",
    "auto_publish": "package_auto_publish"
  }'::jsonb;
  v_fanout_job_types text[] := ARRAY[
    'package_generate_blueprint_variants',
    'package_fanout_learning_content'
  ];
  v_bronze_blocked_types text[] := ARRAY[
    'package_quality_council','package_auto_publish'
  ];
  v_allowed_pkg_states text[] := ARRAY['building', 'council_review'];
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, ps.updated_at AS step_updated_at,
           cp.priority, cp.curriculum_id, cp.status AS pkg_status, c.title, cp.course_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.id = cp.course_id
    WHERE ps.status = 'queued'
      AND cp.status = ANY(v_allowed_pkg_states)
      AND cp.curriculum_id IS NOT NULL
    ORDER BY cp.priority, ps.package_id
    LIMIT 100
  LOOP
    v_checked := v_checked + 1;
    v_step_dist := jsonb_set(v_step_dist, ARRAY[rec.step_key],
      to_jsonb(COALESCE((v_step_dist ->> rec.step_key)::int, 0) + 1));

    v_job_type := v_step_jobs ->> rec.step_key;

    IF v_job_type IS NULL THEN
      v_blocked_unknown_step := v_blocked_unknown_step + 1;
      CONTINUE;
    END IF;

    -- Bronze-Pre-Filter: skip locked packages für Council/AutoPublish
    IF v_job_type = ANY(v_bronze_blocked_types)
       AND public.fn_is_bronze_locked(rec.package_id) THEN
      v_blocked_bronze := v_blocked_bronze + 1;
      -- 1h Cooldown-Audit pro (package, job_type)
      SELECT EXISTS(
        SELECT 1 FROM auto_heal_log
        WHERE action_type='reconcile_skipped_bronze_locked'
          AND target_id = rec.package_id::text
          AND metadata->>'job_type' = v_job_type
          AND created_at > now() - interval '1 hour'
      ) INTO v_recent_audit;
      IF NOT v_recent_audit THEN
        INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
        VALUES('reconcile_skipped_bronze_locked','course_package',rec.package_id::text,'skipped',
          jsonb_build_object(
            'enqueue_source','orphan_reconciler',
            'job_type',v_job_type,
            'step_key',rec.step_key,
            'reason','BRONZE_LOCKED_REQUIRES_REVIEW'));
      END IF;
      CONTINUE;
    END IF;

    IF rec.step_updated_at > now() - interval '10 minutes' THEN
      v_blocked_too_young := v_blocked_too_young + 1;
      CONTINUE;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM step_dag_edges sde
      JOIN package_steps pred ON pred.package_id = rec.package_id
                              AND pred.step_key = sde.depends_on
      WHERE sde.step_key = rec.step_key
        AND pred.status NOT IN ('done', 'skipped')
    ) INTO v_dag_ok;

    IF NOT v_dag_ok THEN
      v_blocked_dag := v_blocked_dag + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status IN ('pending', 'processing', 'batch_pending')
    ) THEN
      v_blocked_inflight := v_blocked_inflight + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status = 'failed'
        AND jq.updated_at > now() - interval '10 minutes'
    ) THEN
      v_blocked_cooldown := v_blocked_cooldown + 1;
      CONTINUE;
    END IF;

    IF v_job_type = ANY(v_fanout_job_types) AND EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status IN ('pending', 'processing', 'batch_pending')
        AND (
          (jq.payload->>'blueprintId') IS NOT NULL
          OR (jq.payload->>'lesson_id') IS NOT NULL
          OR (jq.payload->>'shard_key') IS NOT NULL
        )
    ) THEN
      v_blocked_fanout := v_blocked_fanout + 1;
      CONTINUE;
    END IF;

    v_pool := CASE
      WHEN v_job_type IN ('package_generate_learning_content','package_generate_glossary',
        'package_generate_handbook','package_generate_oral_exam','package_generate_lesson_minichecks',
        'package_generate_exam_pool','package_generate_blueprint_variants',
        'lesson_generate_content_shard','handbook_expand_section') THEN 'content'
      ELSE 'core'
    END;

    INSERT INTO job_queue (package_id, job_type, worker_pool, status, priority, meta, payload)
    VALUES (
      rec.package_id, v_job_type, v_pool, 'pending', rec.priority,
      jsonb_build_object('source', 'orphan_reconciler', 'step_key', rec.step_key,
                         'enqueue_source', 'orphan_reconciler'),
      jsonb_build_object(
        'package_id', rec.package_id::text,
        'curriculum_id', rec.curriculum_id::text,
        'course_id', rec.course_id::text,
        'step_key', rec.step_key,
        'source', 'orphan_reconciler',
        'enqueue_source', 'orphan_reconciler'
      )
    )
    ON CONFLICT DO NOTHING;

    IF FOUND THEN
      v_reconciled := v_reconciled + 1;
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('orphan_step', rec.package_id, rec.step_key,
              jsonb_build_object('job_type', v_job_type, 'pool', v_pool, 'title', rec.title));
      v_details := array_append(v_details, jsonb_build_object(
        'step', rec.step_key, 'package', rec.package_id, 'job_type', v_job_type, 'title', rec.title));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'checked', v_checked,
    'reconciled', v_reconciled,
    'blocked_inflight', v_blocked_inflight,
    'blocked_cooldown', v_blocked_cooldown,
    'blocked_fanout', v_blocked_fanout,
    'blocked_too_young', v_blocked_too_young,
    'blocked_unknown_step', v_blocked_unknown_step,
    'blocked_dag', v_blocked_dag,
    'blocked_bronze_locked', v_blocked_bronze,
    'step_key_distribution', v_step_dist,
    'items', to_jsonb(v_details)
  );
END;
$function$;

-- ============================================================
-- 2) fn_atomic_enqueue_on_step_queued: Bronze-Pre-Filter Trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid;
  v_job_type text;
  v_existing_active int;
  v_recent_done int;
  v_is_applicable boolean;
  v_recent_audit boolean;
  v_bronze_blocked_types text[] := ARRAY['package_quality_council','package_auto_publish'];
BEGIN
  IF NOT (NEW.status = 'queued'::step_status AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'queued'::step_status)) THEN
    RETURN NEW;
  END IF;

  IF NEW.meta ? 'last_atomic_enqueue_at'
     AND (NEW.meta->>'last_atomic_enqueue_at')::timestamptz > now() - interval '30 seconds' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_recent_done
  FROM auto_heal_log
  WHERE action_type IN ('step_finalized_done','step_finalized_skipped')
    AND target_id = NEW.id::text
    AND created_at > now() - interval '5 minutes';
  IF v_recent_done > 0 THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x10_phantom_atomic_blocked','trg_atomic_enqueue_on_step_queued','blocked',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key,
                               'reason','step recently finalized → phantom re-enqueue blocked')::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  v_is_applicable := public.fn_is_step_applicable_for_package(NEW.package_id, NEW.step_key);
  IF v_is_applicable IS FALSE THEN
    NEW.status := 'skipped'::step_status;
    NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object(
      'skipped_reason','TRACK_NOT_APPLICABLE',
      'pattern_x7_auto_skip_at', now()
    );
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x7_auto_reskip','trg_atomic_enqueue_on_step_queued','done',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key)::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id=NEW.package_id;
  v_job_type := 'package_'||NEW.step_key::text;

  -- Bronze-Pre-Filter (Council/AutoPublish): skip locked Pakete
  IF v_job_type = ANY(v_bronze_blocked_types)
     AND public.fn_is_bronze_locked(NEW.package_id) THEN
    SELECT EXISTS(
      SELECT 1 FROM auto_heal_log
      WHERE action_type='atomic_enqueue_skipped_bronze_locked'
        AND target_id = NEW.package_id::text
        AND metadata->>'job_type' = v_job_type
        AND created_at > now() - interval '1 hour'
    ) INTO v_recent_audit;
    IF NOT v_recent_audit THEN
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('atomic_enqueue_skipped_bronze_locked','course_package',NEW.package_id::text,'skipped',
        jsonb_build_object(
          'enqueue_source','trg_atomic_enqueue',
          'job_type',v_job_type,
          'step_key',NEW.step_key,
          'reason','BRONZE_LOCKED_REQUIRES_REVIEW'));
    END IF;
    RETURN NEW;
  END IF;

  IF v_curriculum_id IS NULL THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id, metadata)
    VALUES ('atomic_enqueue_missing_curriculum','trg_atomic_enqueue_on_step_queued','rejected',
            'Cannot enqueue '||v_job_type||' — package missing curriculum_id',
            'package_step', NEW.id::text,
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key));
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_existing_active FROM job_queue
  WHERE package_id=NEW.package_id AND job_type=v_job_type
    AND status IN ('pending','queued','processing','running','batch_pending');
  IF v_existing_active > 0 THEN RETURN NEW; END IF;

  INSERT INTO job_queue(job_type,payload,status,max_attempts,priority,package_id,meta)
  VALUES(v_job_type,
    jsonb_build_object(
      'package_id', NEW.package_id,
      'curriculum_id', v_curriculum_id,
      'step_key', NEW.step_key::text,
      'enqueue_source','trg_atomic_enqueue'
    ),
    'pending',8,50,NEW.package_id,
    jsonb_build_object('source','atomic_step_enqueue','enqueue_source','trg_atomic_enqueue','enqueued_at',now())
  );

  NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object('last_atomic_enqueue_at',now());
  RETURN NEW;
END $function$;