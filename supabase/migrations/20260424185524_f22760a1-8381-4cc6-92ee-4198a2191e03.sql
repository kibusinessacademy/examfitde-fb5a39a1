CREATE OR REPLACE FUNCTION public.fn_auto_heal_cluster(
  _cluster text,
  _max_jobs integer DEFAULT 25,
  _dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_processed int := 0;
  v_skipped int := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_resolver jsonb;
  v_validation jsonb;
  v_job_type text;
  v_payload jsonb;
  v_strategy text;
  v_dup_exists bool;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  FOR v_job IN
    SELECT q.*, c.cluster, c.subcluster, c.error_class AS effective_error_class
    FROM public.job_queue q
    JOIN public.v_admin_queue_job_classification c ON c.id = q.id
    WHERE c.cluster = _cluster
      AND q.status IN ('failed','cancelled','processing')
    ORDER BY q.updated_at DESC NULLS LAST
    LIMIT _max_jobs
  LOOP
    BEGIN
      IF _dry_run THEN
        v_processed := v_processed + 1;
        CONTINUE;
      END IF;

      IF _cluster = 'STALE_LOCK_LOOP_HARD_KILL' THEN
        UPDATE public.job_queue
        SET status = 'pending',
            attempts = GREATEST(0, COALESCE(attempts,0) - 1),
            locked_at = NULL,
            locked_by = NULL,
            run_after = now() + interval '15 seconds',
            updated_at = now()
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster IN ('HARD_FAIL_REPAIR_EXHAUSTED', 'REPAIR_COMPETENCY_COVERAGE') THEN
        v_resolver := public.admin_resolve_repair_strategy_for_package(v_job.package_id);
        v_strategy := v_resolver->>'strategy';
        v_job_type := v_resolver->>'job_type';
        v_payload := v_resolver->'payload';

        IF v_strategy IN ('no_action_active_job_exists','no_action_no_deficit','manual_review_required','forbidden')
           OR v_job_type IS NULL
        THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        v_validation := public.admin_validate_repair_job_type(v_job_type, v_payload);

        IF NOT COALESCE((v_validation->>'valid')::boolean, false) THEN
          v_warnings := v_warnings || jsonb_build_object(
            'job_id', v_job.id,
            'package_id', v_job.package_id,
            'warning', v_validation->>'warning',
            'severity', v_validation->>'severity'
          );

          IF COALESCE(v_validation->>'severity','') = 'high' THEN
            INSERT INTO public.admin_notifications(title, body, severity, category, entity_type, entity_id, metadata)
            VALUES (
              'Repair Job-Type Mismatch',
              v_validation->>'warning',
              'high',
              'queue_validation',
              'course_package',
              v_job.package_id,
              jsonb_build_object(
                'job_type', v_job_type,
                'mode', v_validation->>'mode',
                'source_job', v_job.id,
                'source_cluster', _cluster
              )
            );
            v_skipped := v_skipped + 1;
            CONTINUE;
          END IF;
        END IF;

        SELECT EXISTS (
          SELECT 1
          FROM public.job_queue j
          WHERE j.package_id = v_job.package_id
            AND j.job_type = v_job_type
            AND j.status = ANY(public.fn_job_active_statuses())
            AND COALESCE(j.payload->>'mode','') = COALESCE(v_payload->>'mode','')
        ) INTO v_dup_exists;

        IF v_dup_exists THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        UPDATE public.job_queue
        SET status = 'cancelled',
            completed_at = COALESCE(completed_at, now()),
            updated_at = now(),
            meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
              'superseded_by_auto_heal', true,
              'superseded_at', now(),
              'superseded_by_cluster', _cluster,
              'resolved_strategy', v_strategy,
              'resolved_job_type', v_job_type
            )
        WHERE id = v_job.id;

        INSERT INTO public.job_queue(job_type, package_id, payload, status, run_after, priority, max_attempts, meta)
        VALUES (
          v_job_type,
          v_job.package_id,
          v_payload,
          'pending',
          now() + interval '15 seconds',
          100,
          3,
          jsonb_build_object(
            'auto_heal_origin', _cluster,
            'source_job_id', v_job.id,
            'resolver_reason', v_resolver->>'reason',
            'job_type_validation', v_validation,
            'source_cluster', _cluster,
            'root_job_id', COALESCE(v_job.meta->>'root_job_id', v_job.id::text)
          )
        );
        v_processed := v_processed + 1;

      ELSIF _cluster = 'REQUEUE_LOOP_KILLED' THEN
        IF NOT public.admin_has_recent_terminal_notification(v_job.package_id, v_job.job_type) THEN
          INSERT INTO public.admin_notifications(title, body, severity, category, entity_type, entity_id, metadata)
          VALUES (
            'Requeue-Loop terminal',
            format('Job %s (%s) terminal markiert', v_job.id, v_job.job_type),
            'high', 'queue_terminal', 'course_package', v_job.package_id,
            jsonb_build_object('source_job_id', v_job.id, 'job_type', v_job.job_type)
          );
        END IF;

        UPDATE public.job_queue
        SET status = 'cancelled',
            meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
              'retry_path_terminal', true,
              'terminal_scope', 'job_type_for_package',
              'terminal_reason', 'requeue_loop_killed'
            )
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster = 'UNCLASSIFIED_EMPTY' THEN
        UPDATE public.job_queue
        SET status = 'pending',
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
    'cluster', _cluster,
    'dry_run', _dry_run,
    'processed', v_processed,
    'skipped', v_skipped,
    'warnings', v_warnings,
    'errors', v_errors,
    'completed_at', now()
  );
END;
$function$;