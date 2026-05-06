-- LXI v1 — No-Lessons Repair Dispatcher
-- Enqueues package_generate_learning_content for published packages with lesson_count=0.
-- Idempotent: skips packages with active jobs of the same type.
-- NO status change. NO demote. Audit-tagged in auto_heal_log.

CREATE OR REPLACE VIEW public.v_lxi_no_lessons_targets AS
SELECT v.package_id, v.package_key, v.title, v.curriculum_id, cp.product_id,
       v.approved_exam_question_count, v.oral_blueprint_count,
       v.tutor_context_count, v.learning_integrity_score,
       (SELECT COUNT(*) FROM job_queue jq
         WHERE jq.package_id = v.package_id
           AND jq.job_type IN ('package_generate_learning_content','package_fanout_learning_content',
                               'lesson_generate_competency_bundle','lesson_generate_content','lesson_generate_content_shard')
           AND jq.status IN ('pending','processing','queued')) AS active_lesson_jobs,
       (cp.feature_flags->'bronze'->>'badge') AS bronze_badge
FROM public.v_learning_integrity_audit v
JOIN public.course_packages cp ON cp.id = v.package_id
WHERE v.status = 'published' AND v.gate_no_lessons;

REVOKE ALL ON public.v_lxi_no_lessons_targets FROM PUBLIC;
GRANT SELECT ON public.v_lxi_no_lessons_targets TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_lxi_no_lessons_targets()
RETURNS SETOF public.v_lxi_no_lessons_targets
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.v_lxi_no_lessons_targets ORDER BY title;
END; $$;

REVOKE ALL ON FUNCTION public.admin_get_lxi_no_lessons_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_lxi_no_lessons_targets() TO authenticated, service_role;

-- Dispatcher: enqueue lesson generation for one package OR all eligible
CREATE OR REPLACE FUNCTION public.admin_dispatch_lxi_no_lessons_repair(
  _package_id uuid DEFAULT NULL,
  _dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_target record;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_job_id uuid;
  v_correlation uuid := gen_random_uuid();
  v_skip_reason text;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  FOR v_target IN
    SELECT * FROM public.v_lxi_no_lessons_targets
    WHERE (_package_id IS NULL OR package_id = _package_id)
    ORDER BY title
  LOOP
    v_skip_reason := NULL;

    IF v_target.active_lesson_jobs > 0 THEN
      v_skip_reason := 'ALREADY_HAS_ACTIVE_LESSON_JOB';
    ELSIF v_target.curriculum_id IS NULL THEN
      v_skip_reason := 'NO_CURRICULUM';
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_target.package_id,
        'title', v_target.title,
        'action', 'skipped',
        'reason', v_skip_reason
      );
      CONTINUE;
    END IF;

    IF _dry_run THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_target.package_id,
        'title', v_target.title,
        'action', 'would_enqueue',
        'job_type', 'package_generate_learning_content'
      );
      v_dispatched := v_dispatched + 1;
      CONTINUE;
    END IF;

    -- Real enqueue
    INSERT INTO job_queue (
      job_type, package_id, status, priority, payload, meta, correlation_id
    ) VALUES (
      'package_generate_learning_content',
      v_target.package_id,
      'pending',
      50,
      jsonb_build_object(
        'package_id', v_target.package_id,
        'curriculum_id', v_target.curriculum_id,
        'enqueue_source', 'lxi_no_lessons_repair',
        'mode', 'targeted_lesson_repair',
        'reason', 'gate_no_lessons published package'
      ),
      jsonb_build_object(
        'enqueue_source', 'lxi_no_lessons_repair',
        'correlation_id', v_correlation
      ),
      v_correlation
    )
    RETURNING id INTO v_job_id;

    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('admin_dispatch_lxi_no_lessons_repair', 'lxi_no_lessons_repair_enqueued',
            v_target.package_id::text, 'package', 'success',
            format('Enqueued package_generate_learning_content for %s', v_target.title),
            jsonb_build_object(
              'package_id', v_target.package_id,
              'job_id', v_job_id,
              'correlation_id', v_correlation,
              'approved_exam_questions', v_target.approved_exam_question_count
            ));

    v_dispatched := v_dispatched + 1;
    v_results := v_results || jsonb_build_object(
      'package_id', v_target.package_id,
      'title', v_target.title,
      'action', 'enqueued',
      'job_id', v_job_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', _dry_run,
    'correlation_id', v_correlation,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'results', v_results
  );
END; $$;

REVOKE ALL ON FUNCTION public.admin_dispatch_lxi_no_lessons_repair(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_lxi_no_lessons_repair(uuid, boolean) TO authenticated, service_role;