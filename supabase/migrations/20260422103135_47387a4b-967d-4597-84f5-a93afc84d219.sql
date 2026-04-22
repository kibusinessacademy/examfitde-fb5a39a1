-- Wave-7.1: Patches für 3 P0-Blocker + 3 P1-Härtungen

-- ============================================================================
-- PATCH 1 + ergänzte Felder: Resolver mit korrekter Subquery-Aggregation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg                            record;
  v_curriculum_id                  uuid;
  v_competencies_missing_questions uuid[];
  v_total_blueprints               int;
  v_total_competencies             int;
  v_active_repair_count            int;
  v_recent_no_effect_count         int;
  v_strategy                       text;
  v_job_type                       text;
  v_payload                        jsonb;
  v_reason                         text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('strategy','forbidden','reason','admin_only');
  END IF;

  SELECT id, curriculum_id, status
    INTO v_pkg
  FROM course_packages
  WHERE id = _package_id;

  IF NOT FOUND OR v_pkg.curriculum_id IS NULL THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','no_package_or_curriculum'
    );
  END IF;

  v_curriculum_id := v_pkg.curriculum_id;

  -- Active repair sibling guard
  SELECT count(*) INTO v_active_repair_count
  FROM job_queue
  WHERE package_id = _package_id
    AND status = ANY(public.fn_job_active_statuses())
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage'
    );

  IF v_active_repair_count > 0 THEN
    RETURN jsonb_build_object(
      'strategy','no_action_active_job_exists',
      'reason', format('%s active repair job(s) exist', v_active_repair_count)
    );
  END IF;

  -- NO_EFFECT/NO_PROGRESS guard (24h)
  SELECT count(*) INTO v_recent_no_effect_count
  FROM job_queue
  WHERE package_id = _package_id
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage'
    )
    AND status IN ('failed','cancelled')
    AND COALESCE(updated_at, created_at) > now() - interval '24 hours'
    AND (
      COALESCE(meta->>'progress_delta','0')::int = 0
      OR COALESCE(last_error,'') ILIKE '%NO_EFFECT%'
      OR COALESCE(last_error,'') ILIKE '%NO_PROGRESS%'
    );

  IF v_recent_no_effect_count >= 2 THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','recent_no_effect_or_no_progress_history'
    );
  END IF;

  -- Total competencies via SSOT join
  SELECT count(*) INTO v_total_competencies
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  IF v_total_competencies = 0 THEN
    RETURN jsonb_build_object(
      'strategy','manual_review_required',
      'reason','no_competencies_in_curriculum'
    );
  END IF;

  -- Total blueprints
  SELECT count(*) INTO v_total_blueprints
  FROM exam_question_blueprints b
  JOIN competencies c ON c.id = b.competency_id
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  -- ✅ PATCH 1: Subquery + outer array_agg (vorher: GROUP BY in SELECT...INTO scalar)
  SELECT COALESCE(array_agg(x.id), ARRAY[]::uuid[])
    INTO v_competencies_missing_questions
  FROM (
    SELECT c.id
    FROM competencies c
    JOIN learning_fields lf ON lf.id = c.learning_field_id
    LEFT JOIN exam_questions eq ON eq.competency_id = c.id
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY c.id
    HAVING COUNT(eq.id) < 3
  ) x;

  IF v_total_blueprints = 0 THEN
    -- Blueprint-Fill via package_repair_exam_pool_lf_coverage + mode flag
    v_strategy := 'targeted_blueprint_fill';
    v_job_type := 'package_repair_exam_pool_lf_coverage';
    v_reason   := 'no_blueprints_for_curriculum';
  ELSIF array_length(v_competencies_missing_questions, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'strategy','no_action_no_deficit',
      'reason','all_competencies_have_min_questions'
    );
  ELSE
    v_strategy := 'targeted_competency_fill';
    v_job_type := 'package_repair_exam_pool_competency_coverage';
    v_reason   := format('%s competencies below 3 questions',
                         array_length(v_competencies_missing_questions, 1));
  END IF;

  -- SSOT Payload Contract
  v_payload := jsonb_build_object(
    'package_id',                      _package_id,
    'curriculum_id',                   v_curriculum_id,
    'is_repair',                       true,
    'mode',                            v_strategy,
    'target_competency_ids',           to_jsonb(COALESCE(v_competencies_missing_questions, ARRAY[]::uuid[])),
    'continuation_of_targeted_fill',   false,
    'continuation_depth',              0,
    'source_cluster',                  'REPAIR_COMPETENCY_COVERAGE'
  );

  RETURN jsonb_build_object(
    'strategy',              v_strategy,
    'job_type',              v_job_type,
    'payload',               v_payload,
    'reason',                v_reason,
    'target_competency_ids', to_jsonb(COALESCE(v_competencies_missing_questions, ARRAY[]::uuid[])),
    'total_blueprints',      v_total_blueprints,
    'total_competencies',    v_total_competencies
  );
END;
$$;

-- ============================================================================
-- PATCH 2 + 3 + 4 + 5 + 6: Cluster-Heal mit finalem Dedup-Guard,
-- COALESCE bei attempts, run_after-Backoff, kein manuelles updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_heal_cluster(
  _cluster   text,
  _max_jobs  int  DEFAULT 25,
  _dry_run   bool DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job             record;
  v_processed       int := 0;
  v_skipped         int := 0;
  v_errors          jsonb := '[]'::jsonb;
  v_resolver        jsonb;
  v_job_type        text;
  v_payload         jsonb;
  v_strategy        text;
  v_dup_exists      bool;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  FOR v_job IN
    SELECT q.*, c.cluster, c.subcluster, c.effective_error_class
    FROM job_queue q
    JOIN v_admin_queue_job_classification c ON c.job_id = q.id
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

      IF _cluster = 'STALE_LOCK' THEN
        UPDATE job_queue
        SET status   = 'pending',
            -- ✅ PATCH 5: COALESCE bei attempts
            attempts = GREATEST(0, COALESCE(attempts,0) - 1),
            lease_expires_at = NULL,
            locked_by = NULL,
            -- ✅ PATCH 6: kleines Backoff-Fenster
            run_after = now() + interval '15 seconds'
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster = 'REPAIR_COMPETENCY_COVERAGE' THEN
        v_resolver := public.admin_resolve_repair_strategy_for_package(v_job.package_id);
        v_strategy := v_resolver->>'strategy';

        IF v_strategy IN ('no_action_active_job_exists','no_action_no_deficit',
                          'manual_review_required','forbidden') THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        v_job_type := v_resolver->>'job_type';
        v_payload  := v_resolver->'payload';

        -- ✅ PATCH 3: Finaler Insert-Dedup-Guard (kurz vor INSERT)
        SELECT EXISTS (
          SELECT 1 FROM job_queue j
          WHERE j.package_id = v_job.package_id
            AND j.job_type   = v_job_type
            AND j.status     = ANY(public.fn_job_active_statuses())
            AND COALESCE(j.payload->>'mode','') = COALESCE(v_payload->>'mode','')
        ) INTO v_dup_exists;

        IF v_dup_exists THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        -- Cancel current failed job, enqueue resolver-typed repair
        UPDATE job_queue SET status='cancelled' WHERE id = v_job.id;

        INSERT INTO job_queue(job_type, package_id, payload, status, priority, meta)
        VALUES (
          v_job_type,
          v_job.package_id,
          v_payload,
          'pending',
          50,
          jsonb_build_object(
            'auto_heal_source', 'REPAIR_COMPETENCY_COVERAGE',
            'parent_job_id',    v_job.id,
            'root_job_id',      COALESCE(v_job.meta->>'root_job_id', v_job.id::text),
            'resolver_reason',  v_resolver->>'reason'
          )
        );
        v_processed := v_processed + 1;

      ELSIF _cluster = 'REQUEUE_LOOP' THEN
        IF NOT public.admin_has_recent_terminal_notification(v_job.package_id, v_job.job_type) THEN
          INSERT INTO admin_notifications(title, body, severity, category, entity_type, entity_id, metadata)
          VALUES (
            'Requeue-Loop terminal',
            format('Job %s (%s) terminal markiert', v_job.id, v_job.job_type),
            'high', 'queue_terminal', 'job_queue', v_job.id,
            jsonb_build_object('package_id', v_job.package_id, 'job_type', v_job.job_type)
          );
        END IF;

        UPDATE job_queue
        SET status = 'cancelled',
            meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
              'retry_path_terminal', true,
              'terminal_scope',      'job_type_for_package',
              'terminal_reason',     'requeue_loop_killed'
            )
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster = 'UNCLASSIFIED_RECLASSIFIABLE' THEN
        UPDATE job_queue
        SET status   = 'pending',
            attempts = GREATEST(0, COALESCE(attempts,0) - 1),
            -- ✅ PATCH 7: kleines Backoff (15s)
            run_after = now() + interval '15 seconds',
            meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
              'effective_error_class',  COALESCE(meta->>'error_class', meta->>'error_code'),
              'reclassified_from_meta', true,
              'reclassified_at',        now()
            )
            -- ✅ last_error bleibt unangetastet (forensische Wahrheit)
        WHERE id = v_job.id;
        v_processed := v_processed + 1;

      ELSIF _cluster = 'UNCLASSIFIED_TRANSIENT' THEN
        IF COALESCE(v_job.attempts,0) < 2 THEN
          UPDATE job_queue
          SET status   = 'pending',
              attempts = GREATEST(0, COALESCE(attempts,0) - 1),
              -- ✅ PATCH 6: echtes Backoff für transient
              run_after = now() + interval '60 seconds',
              meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                'last_error_before_retry', last_error,
                'transient_retry_at',      now()
              ),
              last_error = NULL
          WHERE id = v_job.id;
          v_processed := v_processed + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;

      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'job_id', v_job.id,
        'error',  SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'cluster',     _cluster,
    'dry_run',     _dry_run,
    'processed',   v_processed,
    'skipped',     v_skipped,
    'errors',      v_errors,
    'completed_at', now()
  );
END;
$$;