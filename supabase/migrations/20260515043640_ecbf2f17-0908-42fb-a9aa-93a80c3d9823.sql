CREATE OR REPLACE FUNCTION public.fn_dispatch_lf_gap_variant_bridge(p_package_id uuid)
RETURNS TABLE(
  blueprint_id uuid,
  learning_field_id uuid,
  lf_code text,
  action text,
  reason text,
  idempotency_key text,
  job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_subcode text;
  v_curriculum_id uuid;
  v_course_id uuid;
  v_title text;
  v_hour_bucket text := to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24');
  v_enqueued int := 0;
  v_skipped int := 0;
  r record;
  v_idem text;
  v_existing_active uuid;
  v_new_job_id uuid;
BEGIN
  SELECT subcode INTO v_subcode FROM public.fn_classify_lf_repair_root_cause(p_package_id);

  IF v_subcode IS DISTINCT FROM 'LF_REPAIR_NO_EFFECT' THEN
    INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_dispatch_lf_gap_variant_bridge','lf_gap_variant_bridge_skipped',
            p_package_id::text,'package','skipped',
            format('Subcode=%s ist nicht LF_REPAIR_NO_EFFECT', COALESCE(v_subcode,'NULL')),
            jsonb_build_object('package_id', p_package_id, 'subcode', v_subcode, 'reason','SUBCODE_MISMATCH'));
    RETURN;
  END IF;

  SELECT cp.curriculum_id, cp.course_id, cp.title
    INTO v_curriculum_id, v_course_id, v_title
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_dispatch_lf_gap_variant_bridge','lf_gap_variant_bridge_skipped',
            p_package_id::text,'package','skipped','Paket hat keine curriculum_id',
            jsonb_build_object('package_id', p_package_id,'reason','NO_CURRICULUM'));
    RETURN;
  END IF;

  FOR r IN
    SELECT qb.id AS bp_id, qb.learning_field_id AS lf_id, lf.code AS lfc, qb.competency_id
    FROM v_exam_pool_lf_repair_gap_classification g
    JOIN learning_fields lf ON lf.id = g.learning_field_id
    JOIN question_blueprints qb
      ON qb.package_id = g.package_id AND qb.learning_field_id = g.learning_field_id
    LEFT JOIN LATERAL (
      SELECT 1 FROM blueprint_variants bv
      WHERE bv.blueprint_id = qb.id AND bv.validation_passed = true LIMIT 1
    ) ok ON true
    WHERE g.package_id = p_package_id
      AND g.gap_class = 'VARIANT_GAP'
      AND qb.approved_at IS NOT NULL
      AND qb.deprecated_at IS NULL
      AND qb.status <> 'deprecated'::blueprint_status
      AND ok IS NULL
    ORDER BY lf.sort_order, qb.id
  LOOP
    v_idem := format('lf_gap_var_bridge:%s:%s:%s', p_package_id, r.bp_id, v_hour_bucket);

    SELECT j.id INTO v_existing_active
    FROM job_queue j
    WHERE j.job_type = 'package_generate_blueprint_variants'
      AND j.status IN ('pending','queued','processing')
      AND j.package_id = p_package_id
      AND (j.payload->>'blueprint_id')::uuid = r.bp_id
    LIMIT 1;

    IF v_existing_active IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      blueprint_id := r.bp_id; learning_field_id := r.lf_id; lf_code := r.lfc;
      action := 'skipped'; reason := 'ACTIVE_JOB_EXISTS';
      idempotency_key := v_idem; job_id := v_existing_active;
      RETURN NEXT; CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM job_queue jq WHERE jq.idempotency_key = v_idem) THEN
      v_skipped := v_skipped + 1;
      blueprint_id := r.bp_id; learning_field_id := r.lf_id; lf_code := r.lfc;
      action := 'skipped'; reason := 'IDEMPOTENT_HOUR_BUCKET';
      idempotency_key := v_idem; job_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;

    INSERT INTO job_queue(job_type, status, package_id, payload, idempotency_key,
                          priority, max_attempts, run_after, lane)
    VALUES (
      'package_generate_blueprint_variants','pending', p_package_id,
      jsonb_build_object(
        'package_id', p_package_id, 'curriculum_id', v_curriculum_id, 'course_id', v_course_id,
        'blueprint_id', r.bp_id, 'learning_field_filter', r.lf_id, 'competency_id', r.competency_id,
        'count', 5, 'subject_name', v_title,
        '_origin','lf_gap_variant_bridge', 'enqueue_source','lf_gap_variant_bridge',
        'step_key','generate_blueprint_variants'),
      v_idem, 5, 3, now(), 'content')
    RETURNING id INTO v_new_job_id;

    v_enqueued := v_enqueued + 1;

    INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_dispatch_lf_gap_variant_bridge','lf_gap_variant_bridge_enqueued',
            p_package_id::text,'package','success',
            format('Enqueued variant generator for BP %s (LF %s)', r.bp_id, r.lfc),
            jsonb_build_object('package_id', p_package_id,'blueprint_id', r.bp_id,
                               'learning_field_id', r.lf_id,'lf_code', r.lfc,
                               'competency_id', r.competency_id,
                               'idempotency_key', v_idem,'job_id', v_new_job_id));

    blueprint_id := r.bp_id; learning_field_id := r.lf_id; lf_code := r.lfc;
    action := 'enqueued'; reason := 'OK';
    idempotency_key := v_idem; job_id := v_new_job_id;
    RETURN NEXT;
  END LOOP;

  INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('fn_dispatch_lf_gap_variant_bridge','lf_gap_variant_bridge_summary',
          p_package_id::text,'package',
          CASE WHEN v_enqueued > 0 THEN 'success' ELSE 'noop' END,
          format('Enqueued=%s, Skipped=%s', v_enqueued, v_skipped),
          jsonb_build_object('package_id', p_package_id,'enqueued', v_enqueued,
                             'skipped', v_skipped,'hour_bucket', v_hour_bucket));
END;
$$;