DO $$
DECLARE
  r record;
  v_idem text;
  v_job_id uuid;
  v_override bool;
  v_enqueued int := 0;
  v_skipped int := 0;
  v_overridden int := 0;
BEGIN
  FOR r IN
    WITH ef AS (
      SELECT cp.id, cp.curriculum_id, cp.status, cp.feature_flags
      FROM course_packages cp WHERE cp.track='EXAM_FIRST'
    ),
    agg AS (
      SELECT ef.*,
        (SELECT count(*) FROM oral_exam_blueprints b WHERE b.curriculum_id=ef.curriculum_id AND b.status='approved') approved_oral_bp
      FROM ef
    )
    SELECT id, curriculum_id, status, feature_flags,
      COALESCE((feature_flags->'bronze'->>'requires_review')::bool,false) bronze_lock
    FROM agg
    WHERE approved_oral_bp = 0
      AND id::text NOT LIKE 'd2000000-%'  -- skip e2e smoke fixtures
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id=agg.id
          AND jq.job_type='package_seed_oral_blueprints'
          AND jq.status IN ('pending','processing')
      )
  LOOP
    v_idem := 'exam_first_oral_seed:' || r.id || ':' || to_char(now(), 'YYYYMMDDHH24');
    IF EXISTS (SELECT 1 FROM job_queue WHERE idempotency_key=v_idem) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_override := r.bronze_lock;

    INSERT INTO job_queue(
      job_type, status, payload, package_id,
      max_attempts, priority, worker_pool, idempotency_key, meta
    )
    VALUES (
      'package_seed_oral_blueprints', 'pending',
      jsonb_build_object(
        'package_id', r.id,
        'curriculum_id', r.curriculum_id,
        'action', 'seed_oral_blueprints',
        'bronze_lock_override', v_override,
        '_origin', 'exam_first_oral_coverage_heal',
        'reason', 'exam_first_zero_approved_oral_blueprints'
      ),
      r.id, 3, 50, 'content', v_idem,
      jsonb_build_object('enqueue_source','exam_first_oral_coverage_heal','bypass_audit', v_override)
    )
    RETURNING id INTO v_job_id;

    v_enqueued := v_enqueued + 1;
    IF v_override THEN v_overridden := v_overridden + 1; END IF;

    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'exam_first_oral_coverage_heal','package', r.id, 'enqueued',
      jsonb_build_object(
        'job_id', v_job_id,
        'idempotency_key', v_idem,
        'package_status', r.status,
        'bronze_lock', r.bronze_lock,
        'bronze_lock_override', v_override,
        'curriculum_id', r.curriculum_id,
        'origin','exam_first_oral_coverage_heal'
      )
    );
  END LOOP;

  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'exam_first_oral_coverage_heal_summary','system', NULL, 'ok',
    jsonb_build_object(
      'enqueued', v_enqueued,
      'skipped_idempotent', v_skipped,
      'bronze_overridden', v_overridden,
      'job_type','package_seed_oral_blueprints'
    )
  );

  RAISE NOTICE 'oral_coverage_heal: enqueued=% overridden=% skipped=%', v_enqueued, v_overridden, v_skipped;
END $$;