-- Wave-7.2: Konsistenz-Patch + Blueprint Job-Type Validator (Final)

CREATE OR REPLACE FUNCTION public.admin_has_recent_terminal_notification(
  _package_id uuid,
  _job_type   text,
  _within     interval DEFAULT interval '24 hours'
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE category = 'queue_terminal'
      AND entity_type = 'course_package'
      AND entity_id = _package_id
      AND COALESCE(metadata->>'job_type','') = _job_type
      AND is_read = false
      AND created_at > now() - _within
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_validate_repair_job_type(
  _job_type text, _payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mode text := _payload->>'mode';
  v_is_repair bool := COALESCE((_payload->>'is_repair')::bool, false);
  v_valid bool := true;
  v_warning text := NULL;
  v_severity text := 'info';
BEGIN
  IF v_mode = 'targeted_blueprint_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_lf_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('Blueprint-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_lf_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_mode = 'targeted_competency_fill' THEN
    IF _job_type <> 'package_repair_exam_pool_competency_coverage' THEN
      v_valid := false; v_severity := 'high';
      v_warning := format('Competency-Fill-Mode (%s) verwendet falschen job_type %s. Erwartet: package_repair_exam_pool_competency_coverage', v_mode, _job_type);
    END IF;
  ELSIF v_is_repair AND v_mode IS NULL THEN
    v_valid := false; v_severity := 'medium';
    v_warning := format('Repair-Job %s ohne mode-Flag im Payload', _job_type);
  END IF;

  RETURN jsonb_build_object('valid',v_valid,'warning',v_warning,'severity',v_severity,'job_type',_job_type,'mode',v_mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_auto_heal_cluster(
  _cluster text, _max_jobs int DEFAULT 25, _dry_run bool DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_job record; v_processed int := 0; v_skipped int := 0;
  v_warnings jsonb := '[]'::jsonb; v_errors jsonb := '[]'::jsonb;
  v_resolver jsonb; v_validation jsonb;
  v_job_type text; v_payload jsonb; v_strategy text; v_dup_exists bool;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  FOR v_job IN
    SELECT q.*, c.cluster, c.subcluster, c.error_class AS effective_error_class
    FROM job_queue q
    JOIN v_admin_queue_job_classification c ON c.id = q.id
    WHERE c.cluster = _cluster
      AND q.status IN ('failed','cancelled','processing')
    ORDER BY q.updated_at DESC NULLS LAST
    LIMIT _max_jobs
  LOOP
    BEGIN
      IF _dry_run THEN v_processed := v_processed + 1; CONTINUE; END IF;

      IF _cluster = 'STALE_LOCK_LOOP_HARD_KILL' THEN
        UPDATE job_queue SET status='pending',
          attempts = GREATEST(0, COALESCE(attempts,0) - 1),
          lease_expires_at = NULL, locked_by = NULL,
          run_after = now() + interval '15 seconds'
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster = 'HARD_FAIL_REPAIR_EXHAUSTED' THEN
        v_resolver := public.admin_resolve_repair_strategy_for_package(v_job.package_id);
        v_strategy := v_resolver->>'strategy';

        IF v_strategy IN ('no_action_active_job_exists','no_action_no_deficit','manual_review_required','forbidden') THEN
          v_skipped := v_skipped + 1; CONTINUE;
        END IF;

        v_job_type := v_resolver->>'job_type';
        v_payload  := v_resolver->'payload';
        v_validation := public.admin_validate_repair_job_type(v_job_type, v_payload);

        IF NOT (v_validation->>'valid')::bool THEN
          v_warnings := v_warnings || jsonb_build_object(
            'job_id', v_job.id, 'package_id', v_job.package_id,
            'warning', v_validation->>'warning', 'severity', v_validation->>'severity'
          );
          IF (v_validation->>'severity') = 'high' THEN
            INSERT INTO admin_notifications(title, body, severity, category, entity_type, entity_id, metadata)
            VALUES (
              'Repair Job-Type Mismatch', v_validation->>'warning',
              'high', 'queue_validation', 'course_package', v_job.package_id,
              jsonb_build_object('job_type', v_job_type, 'mode', v_validation->>'mode', 'source_job', v_job.id)
            );
            v_skipped := v_skipped + 1; CONTINUE;
          END IF;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM job_queue j
          WHERE j.package_id = v_job.package_id
            AND j.job_type = v_job_type
            AND j.status = ANY(public.fn_job_active_statuses())
            AND COALESCE(j.payload->>'mode','') = COALESCE(v_payload->>'mode','')
        ) INTO v_dup_exists;

        IF v_dup_exists THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

        UPDATE job_queue SET status='cancelled' WHERE id = v_job.id;
        INSERT INTO job_queue(job_type, package_id, payload, status, priority, meta)
        VALUES (
          v_job_type, v_job.package_id, v_payload, 'pending', 50,
          jsonb_build_object(
            'auto_heal_source', _cluster,
            'parent_job_id', v_job.id,
            'root_job_id', COALESCE(v_job.meta->>'root_job_id', v_job.id::text),
            'resolver_reason', v_resolver->>'reason',
            'job_type_validation', v_validation
          )
        );
        v_processed := v_processed + 1;

      ELSIF _cluster = 'REQUEUE_LOOP_KILLED' THEN
        IF NOT public.admin_has_recent_terminal_notification(v_job.package_id, v_job.job_type) THEN
          INSERT INTO admin_notifications(title, body, severity, category, entity_type, entity_id, metadata)
          VALUES (
            'Requeue-Loop terminal',
            format('Job %s (%s) terminal markiert', v_job.id, v_job.job_type),
            'high', 'queue_terminal', 'course_package', v_job.package_id,
            jsonb_build_object('source_job_id', v_job.id, 'job_type', v_job.job_type)
          );
        END IF;

        UPDATE job_queue SET status='cancelled',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'retry_path_terminal', true,
            'terminal_scope', 'job_type_for_package',
            'terminal_reason', 'requeue_loop_killed'
          )
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster = 'UNCLASSIFIED_EMPTY' THEN
        UPDATE job_queue SET status='pending',
          attempts = GREATEST(0, COALESCE(attempts,0) - 1),
          run_after = now() + interval '15 seconds',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'effective_error_class', COALESCE(meta->>'error_class', meta->>'error_code'),
            'reclassified_from_meta', true,
            'reclassified_at', now()
          )
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('job_id', v_job.id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'cluster', _cluster, 'dry_run', _dry_run,
    'processed', v_processed, 'skipped', v_skipped,
    'warnings', v_warnings, 'errors', v_errors,
    'completed_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_queue_validation_warnings(_limit int DEFAULT 20)
RETURNS TABLE(
  id uuid, package_id uuid, title text, body text, severity text,
  job_type text, mode text, source_job_id uuid,
  created_at timestamptz, is_read boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT n.id, n.entity_id AS package_id, n.title, n.body, n.severity,
    n.metadata->>'job_type' AS job_type, n.metadata->>'mode' AS mode,
    NULLIF(n.metadata->>'source_job','')::uuid AS source_job_id,
    n.created_at, n.is_read
  FROM admin_notifications n
  WHERE n.category = 'queue_validation'
    AND public.is_admin_user(auth.uid())
  ORDER BY n.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 200));
$$;

GRANT EXECUTE ON FUNCTION public.admin_validate_repair_job_type(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_queue_validation_warnings(int) TO authenticated;