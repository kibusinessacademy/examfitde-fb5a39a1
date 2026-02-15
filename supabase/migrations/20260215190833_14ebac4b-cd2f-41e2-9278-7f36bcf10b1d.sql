
-- Auto-heal shallow content using correct enum values
CREATE OR REPLACE FUNCTION public.auto_heal_shallow_content()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_healed int := 0;
  v_handbook_requeued int := 0;
  v_oral_requeued int := 0;
  r record;
  v_shallow_handbook int;
  v_shallow_oral int;
BEGIN
  FOR r IN
    SELECT cp.id AS package_id, cp.curriculum_id
    FROM course_packages cp
    LEFT JOIN (
      SELECT ct.certification_id, count(*) AS sc
      FROM curriculum_topics ct WHERE ct.parent_topic_id IS NOT NULL
      GROUP BY ct.certification_id
    ) td ON td.certification_id = cp.certification_id
    WHERE cp.status IN ('published', 'building', 'ready', 'done')
      AND COALESCE(td.sc, 0) > 5
  LOOP
    SELECT count(*) INTO v_shallow_handbook
    FROM handbook_chapters hc
    JOIN handbook_sections hs ON hs.chapter_id = hc.id
    WHERE hc.curriculum_id = r.curriculum_id
      AND hs.content_markdown NOT LIKE '%aus dem Rahmenplan%';

    IF v_shallow_handbook > 0 THEN
      UPDATE package_steps SET status = 'queued', started_at = NULL, finished_at = NULL
      WHERE package_id = r.package_id AND step_key = 'generate_handbook' AND status = 'done';
      IF FOUND THEN v_handbook_requeued := v_handbook_requeued + 1;
        INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
        VALUES ('depth_requeue', 'auto_heal_shallow', 'handbook', r.package_id::text, 'success', format('%s shallow sections', v_shallow_handbook));
      END IF;
    END IF;

    SELECT count(*) INTO v_shallow_oral
    FROM oral_exam_blueprints oeb
    WHERE oeb.curriculum_id = r.curriculum_id
      AND oeb.scenario NOT LIKE '%Fachthemen aus dem Rahmenplan%'
      AND oeb.scenario NOT LIKE '%Relevante Fachthemen%';

    IF v_shallow_oral > 0 THEN
      UPDATE package_steps SET status = 'queued', started_at = NULL, finished_at = NULL
      WHERE package_id = r.package_id AND step_key = 'generate_oral_exam' AND status = 'done';
      IF FOUND THEN v_oral_requeued := v_oral_requeued + 1;
        INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
        VALUES ('depth_requeue', 'auto_heal_shallow', 'oral_exam', r.package_id::text, 'success', format('%s shallow blueprints', v_shallow_oral));
      END IF;
    END IF;

    v_healed := v_healed + 1;
  END LOOP;
  RETURN jsonb_build_object('packages_checked', v_healed, 'handbook_requeued', v_handbook_requeued, 'oral_exam_requeued', v_oral_requeued, 'ts', now());
END;
$$;

-- Integrate into auto_ops_cycle
CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result jsonb := '{}'::jsonb; v_depth_heal jsonb; v_count int;
BEGIN
  BEGIN v_count := auto_link_certification_documents(); v_result := v_result || jsonb_build_object('depth_linked', v_count);
    v_count := auto_seed_curriculum_topics(); v_result := v_result || jsonb_build_object('depth_seeded', v_count);
  EXCEPTION WHEN OTHERS THEN v_result := v_result || jsonb_build_object('depth_error', SQLERRM); END;

  BEGIN v_depth_heal := auto_heal_shallow_content(); v_result := v_result || jsonb_build_object('depth_heal', v_depth_heal);
  EXCEPTION WHEN OTHERS THEN v_result := v_result || jsonb_build_object('depth_heal_error', SQLERRM); END;

  BEGIN
    WITH retryable AS (SELECT id FROM job_queue WHERE status = 'failed' AND attempts < max_attempts AND created_at > now() - interval '7 days' LIMIT 20)
    UPDATE job_queue SET status = 'pending', run_after = now() + interval '30 seconds' WHERE id IN (SELECT id FROM retryable);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_result := v_result || jsonb_build_object('jobs_retried', v_count);
  EXCEPTION WHEN OTHERS THEN v_result := v_result || jsonb_build_object('retry_error', SQLERRM); END;

  BEGIN
    WITH stuck AS (SELECT id FROM job_queue WHERE status = 'processing' AND started_at < now() - interval '15 minutes' LIMIT 10)
    UPDATE job_queue SET status = 'pending', run_after = now() + interval '1 minute' WHERE id IN (SELECT id FROM stuck);
    GET DIAGNOSTICS v_count = ROW_COUNT; v_result := v_result || jsonb_build_object('stuck_rescued', v_count);
  EXCEPTION WHEN OTHERS THEN v_result := v_result || jsonb_build_object('stuck_error', SQLERRM); END;

  BEGIN DELETE FROM pipeline_lock WHERE locked_at < now() - interval '30 minutes';
    DELETE FROM course_generation_locks WHERE locked_at < now() - interval '30 minutes';
    v_result := v_result || jsonb_build_object('locks_cleaned', true);
  EXCEPTION WHEN OTHERS THEN v_result := v_result || jsonb_build_object('locks_error', SQLERRM); END;

  RETURN v_result;
END;
$$;

-- Run NOW to retroactively fix shallow content
SELECT auto_heal_shallow_content();
