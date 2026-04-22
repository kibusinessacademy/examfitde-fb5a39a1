-- ═══════════════════════════════════════════════════════════════════
-- Wave-7 Hardened Repair-Chain (Retry mit korrigiertem entity_id-Typ)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_queue_cluster_weight(_cluster text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE _cluster
    WHEN 'HARD_FAIL_NO_BLUEPRINTS'      THEN 20
    WHEN 'HARD_FAIL_NO_CURRICULUM'      THEN 20
    WHEN 'HARD_FAIL_SCHEMA_MISMATCH'    THEN 20
    WHEN 'UNCLASSIFIED_STRUCTURAL'      THEN 8
    WHEN 'REQUEUE_LOOP_KILLED'          THEN 10
    WHEN 'REPAIR_COMPETENCY_COVERAGE'   THEN 5
    WHEN 'REPAIR_LF_COVERAGE'           THEN 5
    WHEN 'STALE_LOCK_LOOP_HARD_KILL'    THEN 2
    WHEN 'UNCLASSIFIED_RECLASSIFIABLE'  THEN 2
    WHEN 'UNCLASSIFIED_TRANSIENT'       THEN 1
    WHEN 'TIMEOUT'                      THEN 1
    WHEN 'RATE_LIMIT'                   THEN 1
    WHEN 'NETWORK_ERROR'                THEN 1
    WHEN 'WATCHDOG_RECOVERY'            THEN 1
    ELSE 3
  END
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_active_count int;
  v_no_effect_history int;
  v_total_competencies int;
  v_competencies_missing_questions uuid[];
  v_total_blueprints int;
  v_root_job_id uuid;
  v_strategy text;
  v_job_type text;
  v_payload jsonb;
  v_reason text;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = _package_id;
  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('strategy','manual_review_required','job_type',NULL,'payload',NULL,'reason','no_curriculum');
  END IF;

  SELECT COUNT(*) INTO v_active_count FROM job_queue
  WHERE package_id = _package_id
    AND status IN ('pending','processing','enqueued')
    AND job_type IN ('package_repair_exam_pool_competency_coverage','package_repair_exam_pool_lf_coverage',
                     'targeted_blueprint_fill','targeted_competency_fill');
  IF v_active_count > 0 THEN
    RETURN jsonb_build_object('strategy','no_action_active_job_exists','job_type',NULL,'payload',NULL,
      'reason', format('%s active repair job(s)', v_active_count));
  END IF;

  SELECT COUNT(*) INTO v_no_effect_history FROM job_queue
  WHERE package_id = _package_id
    AND status IN ('failed','cancelled')
    AND (last_error ILIKE '%no_effect%' OR last_error ILIKE '%no_progress%'
         OR meta->>'error_class' IN ('NO_EFFECT','NO_PROGRESS'))
    AND created_at > now() - interval '24 hours';
  IF v_no_effect_history >= 2 THEN
    RETURN jsonb_build_object('strategy','manual_review_required','job_type',NULL,'payload',NULL,
      'reason', format('NO_EFFECT/NO_PROGRESS history (%s in last 24h)', v_no_effect_history));
  END IF;

  SELECT COUNT(*) INTO v_total_competencies
  FROM competencies c JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;
  IF v_total_competencies = 0 THEN
    RETURN jsonb_build_object('strategy','manual_review_required','job_type',NULL,'payload',NULL,'reason','no_competencies_in_curriculum');
  END IF;

  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO v_competencies_missing_questions
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  LEFT JOIN exam_questions eq ON eq.competency_id = c.id
  WHERE lf.curriculum_id = v_curriculum_id
  GROUP BY c.id HAVING COUNT(eq.id) < 3;

  SELECT COUNT(*) INTO v_total_blueprints FROM exam_blueprints WHERE curriculum_id = v_curriculum_id;

  IF array_length(v_competencies_missing_questions,1) IS NULL THEN
    RETURN jsonb_build_object('strategy','no_action_no_deficit','job_type',NULL,'payload',NULL,'reason','all_competencies_have_questions');
  END IF;

  SELECT id INTO v_root_job_id FROM job_queue
  WHERE package_id = _package_id AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1;

  IF v_total_blueprints = 0 THEN
    v_strategy := 'targeted_blueprint_fill';
    v_job_type := 'package_repair_exam_pool_lf_coverage';
    v_reason := 'no_blueprints_present';
  ELSE
    v_strategy := 'targeted_competency_fill';
    v_job_type := 'package_repair_exam_pool_competency_coverage';
    v_reason := format('%s competencies with deficit, %s blueprints available',
                       array_length(v_competencies_missing_questions,1), v_total_blueprints);
  END IF;

  v_payload := jsonb_build_object(
    'package_id', _package_id, 'curriculum_id', v_curriculum_id,
    'is_repair', true, 'mode', v_strategy,
    'target_competency_ids', to_jsonb(v_competencies_missing_questions),
    'continuation_of_targeted_fill', false, 'continuation_depth', 0,
    'root_job_id', v_root_job_id, 'parent_job_id', v_root_job_id,
    'source', 'auto_heal_resolver_v7', 'resolver_version', 7
  );

  RETURN jsonb_build_object('strategy', v_strategy, 'job_type', v_job_type, 'payload', v_payload,
    'reason', v_reason, 'target_competency_ids', to_jsonb(v_competencies_missing_questions));
END;
$$;

-- entity_id ist uuid → kein Cast
CREATE OR REPLACE FUNCTION public.admin_has_recent_terminal_notification(
  _package_id uuid, _job_type text, _within interval DEFAULT interval '24 hours'
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE entity_id = _package_id
      AND category = 'queue_terminal'
      AND metadata->>'job_type' = _job_type
      AND created_at > now() - _within
      AND is_read = false
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_auto_heal_cluster(
  _cluster text, _max_jobs int DEFAULT 50, _dry_run boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_processed int := 0; v_skipped int := 0; v_errors int := 0;
  v_details jsonb := '[]'::jsonb;
  v_job record; v_resolver jsonb;
  v_strategy text; v_job_type text; v_payload jsonb;
  v_existing_meta jsonb;
BEGIN
  IF _cluster IS NULL THEN RETURN jsonb_build_object('error','cluster_required','processed',0); END IF;

  FOR v_job IN
    SELECT * FROM v_admin_queue_job_classification
    WHERE cluster = _cluster ORDER BY updated_at ASC LIMIT _max_jobs
  LOOP
    BEGIN
      IF COALESCE(v_job.has_active_sibling,false) OR COALESCE(v_job.has_newer_success,false) THEN
        v_skipped := v_skipped + 1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','skip',
          'reason', CASE WHEN v_job.has_active_sibling THEN 'active_sibling' ELSE 'newer_success' END);
        CONTINUE;
      END IF;

      IF _cluster = 'STALE_LOCK_LOOP_HARD_KILL' THEN
        IF NOT _dry_run THEN
          UPDATE job_queue SET status='pending', attempts=GREATEST(0,attempts-1), updated_at=now(),
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object('auto_heal_v7',true,'healed_at',now(),'healed_cluster',_cluster)
          WHERE id=v_job.id;
        END IF;
        v_processed := v_processed+1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','reset_to_pending');

      ELSIF _cluster = 'REPAIR_COMPETENCY_COVERAGE' THEN
        v_resolver := admin_resolve_repair_strategy_for_package(v_job.package_id);
        v_strategy := v_resolver->>'strategy';
        v_job_type := v_resolver->>'job_type';
        v_payload  := v_resolver->'payload';

        IF v_strategy IN ('manual_review_required','no_action_active_job_exists','no_action_no_deficit') THEN
          v_skipped := v_skipped+1;
          v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','skip',
            'reason',v_resolver->>'reason','strategy',v_strategy);
          CONTINUE;
        END IF;

        IF NOT _dry_run THEN
          UPDATE job_queue SET status='cancelled', updated_at=now(),
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object('auto_heal_v7',true,
              'replaced_by_strategy',v_strategy,'cancel_reason','replaced_by_resolver_enqueue')
          WHERE id=v_job.id;

          INSERT INTO job_queue(job_type,status,package_id,payload,meta,max_attempts)
          VALUES (v_job_type,'pending',v_job.package_id,v_payload,
            jsonb_build_object('enqueued_by_auto_heal_v7',true,'source_cluster',_cluster,
              'resolver_reason',v_resolver->>'reason','strategy',v_strategy), 3);
        END IF;
        v_processed := v_processed+1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','cancel_and_enqueue',
          'enqueued_job_type',v_job_type,'strategy',v_strategy);

      ELSIF _cluster = 'REQUEUE_LOOP_KILLED' THEN
        IF NOT _dry_run THEN
          UPDATE job_queue SET updated_at=now(),
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object('auto_heal_v7',true,
              'retry_path_terminal',true,'terminal_scope','job_type_for_package',
              'terminal_reason','requeue_loop_killed','suggested_followup','manual_review','healed_at',now())
          WHERE id=v_job.id;

          IF NOT admin_has_recent_terminal_notification(v_job.package_id, v_job.job_type) THEN
            INSERT INTO admin_notifications(title,body,severity,category,entity_id,entity_type,metadata)
            VALUES (format('Requeue-Loop terminal: %s', v_job.job_type),
              format('Job %s wurde retry_path_terminal markiert (Paket %s)', v_job.id, v_job.package_id),
              'warning','queue_terminal', v_job.package_id,'course_package',
              jsonb_build_object('job_id',v_job.id,'job_type',v_job.job_type,'cluster',_cluster));
          END IF;
        END IF;
        v_processed := v_processed+1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','retry_path_terminal');

      ELSIF _cluster = 'UNCLASSIFIED_RECLASSIFIABLE' THEN
        IF NOT _dry_run THEN
          v_existing_meta := COALESCE(v_job.meta,'{}'::jsonb);
          UPDATE job_queue SET status='pending', updated_at=now(),
            meta = v_existing_meta || jsonb_build_object('auto_heal_v7',true,
              'effective_error_class',COALESCE(v_existing_meta->>'error_class', v_existing_meta->>'error_code'),
              'reclassified_from_meta',true,'reclassified_at',now())
          WHERE id=v_job.id;
        END IF;
        v_processed := v_processed+1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','reclassify_and_retry');

      ELSIF _cluster = 'UNCLASSIFIED_TRANSIENT' THEN
        IF COALESCE((v_job.meta->>'soft_retry_count')::int, 0) >= 1 THEN
          v_skipped := v_skipped+1;
          v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','skip','reason','soft_retry_cap');
          CONTINUE;
        END IF;
        IF NOT _dry_run THEN
          v_existing_meta := COALESCE(v_job.meta,'{}'::jsonb);
          UPDATE job_queue SET status='pending', updated_at=now(), last_error=NULL,
            meta = v_existing_meta || jsonb_build_object('auto_heal_v7',true,
              'last_error_before_retry', v_job.last_error,
              'soft_retry_count', COALESCE((v_existing_meta->>'soft_retry_count')::int,0)+1,
              'soft_retried_at', now())
          WHERE id=v_job.id;
        END IF;
        v_processed := v_processed+1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','soft_retry');

      ELSIF _cluster IN ('TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY') THEN
        IF NOT _dry_run THEN
          UPDATE job_queue SET status='pending', updated_at=now(),
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object('auto_heal_v7',true,'backoff_retry',true,'healed_cluster',_cluster)
          WHERE id=v_job.id;
        END IF;
        v_processed := v_processed+1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','backoff_retry');

      ELSE
        v_skipped := v_skipped+1;
        v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','skip','reason','unsupported_cluster');
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors+1;
      v_details := v_details || jsonb_build_object('job_id',v_job.id,'action','error','error',SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('cluster',_cluster,'dry_run',_dry_run,
    'processed',v_processed,'skipped',v_skipped,'errors',v_errors,
    'details', CASE WHEN jsonb_array_length(v_details) > 20
      THEN (SELECT jsonb_agg(d) FROM (SELECT d FROM jsonb_array_elements(v_details) d LIMIT 20) s)
      ELSE v_details END,
    'wave','v7');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_queue_health_score()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_score int := 100; v_penalty int := 0;
  v_breakdown jsonb := '{}'::jsonb; v_status text;
  v_failed int; v_pending int; v_processing int;
  r record;
BEGIN
  FOR r IN
    SELECT cluster, COUNT(*)::int AS n FROM v_admin_queue_job_classification
    WHERE status IN ('failed','pending','processing','cancelled') GROUP BY cluster
  LOOP
    v_penalty := v_penalty + (admin_queue_cluster_weight(r.cluster) * r.n);
    v_breakdown := v_breakdown || jsonb_build_object(r.cluster,
      jsonb_build_object('count',r.n,'weight',admin_queue_cluster_weight(r.cluster),
        'penalty',admin_queue_cluster_weight(r.cluster)*r.n));
  END LOOP;

  SELECT COUNT(*) FILTER (WHERE status='failed'),
         COUNT(*) FILTER (WHERE status='pending'),
         COUNT(*) FILTER (WHERE status='processing')
  INTO v_failed, v_pending, v_processing FROM job_queue;

  v_penalty := v_penalty + LEAST(30, GREATEST(0, (v_pending - 50) / 10));
  v_score := GREATEST(0, 100 - v_penalty);

  v_status := CASE WHEN v_score >= 85 THEN 'healthy' WHEN v_score >= 65 THEN 'attention'
                   WHEN v_score >= 40 THEN 'degraded' ELSE 'critical' END;

  RETURN jsonb_build_object('score',v_score,'status',v_status,
    'weighted_breakdown',v_breakdown,
    'queue_counts',jsonb_build_object('failed',v_failed,'pending',v_pending,'processing',v_processing),
    'wave','v7');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_resolve_repair_strategy_for_package(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue_cluster_weight(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_heal_cluster(text,int,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_queue_health_score() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_has_recent_terminal_notification(uuid,text,interval) TO authenticated;