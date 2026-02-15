
-- =============================================
-- 1. Fix document linkage for Wirtschaftsfachwirt
-- =============================================
UPDATE certification_documents
SET certification_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
WHERE certification_id = '271c7fe7-2f15-404c-a0c3-ad87eb6d012a'
  AND status = 'active';

UPDATE certification_documents
SET certification_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
WHERE certification_id = 'c09b2c12-0c63-4d76-9544-4e1062eb59b6'
  AND status = 'active';

-- =============================================
-- 2. Add curriculum_ingest step (status='queued')
-- =============================================
INSERT INTO package_steps (package_id, step_key, status, attempts, max_attempts, timeout_seconds)
SELECT cp.id, 'curriculum_ingest', 'queued'::step_status, 0, 3, 300
FROM course_packages cp
WHERE cp.priority <= 100
  AND NOT EXISTS (
    SELECT 1 FROM package_steps ps 
    WHERE ps.package_id = cp.id AND ps.step_key = 'curriculum_ingest'
  );

-- Auto-skip if topics already exist
UPDATE package_steps ps
SET status = 'done'::step_status, finished_at = now()
WHERE ps.step_key = 'curriculum_ingest'
  AND ps.status = 'queued'::step_status
  AND EXISTS (
    SELECT 1 FROM course_packages cp
    JOIN curriculum_topics ct ON ct.certification_id = cp.certification_id
    WHERE cp.id = ps.package_id
    HAVING count(*) >= 5
  );

-- =============================================
-- 3. Step prerequisite map
-- =============================================
CREATE OR REPLACE FUNCTION public.get_step_prerequisite(p_step_key text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_step_key
    WHEN 'curriculum_ingest' THEN RETURN NULL;
    WHEN 'scaffold_learning_course' THEN RETURN 'curriculum_ingest';
    WHEN 'auto_seed_exam_blueprints' THEN RETURN 'scaffold_learning_course';
    WHEN 'generate_exam_pool' THEN RETURN 'auto_seed_exam_blueprints';
    WHEN 'generate_oral_exam' THEN RETURN 'generate_exam_pool';
    WHEN 'build_ai_tutor_index' THEN RETURN 'generate_oral_exam';
    WHEN 'generate_handbook' THEN RETURN 'build_ai_tutor_index';
    WHEN 'run_integrity_check' THEN RETURN 'generate_handbook';
    WHEN 'quality_council' THEN RETURN 'run_integrity_check';
    WHEN 'auto_publish' THEN RETURN 'quality_council';
    ELSE RETURN NULL;
  END CASE;
END;
$$;

-- =============================================
-- 4. Auto-ingest trigger function
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_trigger_curriculum_ingest()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_triggered integer := 0;
  v_pkg record;
  v_doc record;
BEGIN
  FOR v_pkg IN 
    SELECT ps.id as step_id, ps.package_id, cp.curriculum_id, cp.certification_id, cp.priority
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    JOIN curricula cur ON cur.id = cp.curriculum_id
    WHERE ps.step_key = 'curriculum_ingest'
      AND ps.status = 'queued'::step_status
      AND cur.status = 'frozen'
      AND cp.priority <= (SELECT get_priority_ceiling())
    ORDER BY cp.priority ASC
    LIMIT 3
  LOOP
    -- Skip if topics already exist
    IF (SELECT count(*) FROM curriculum_topics ct 
        WHERE ct.certification_id = COALESCE(v_pkg.certification_id, v_pkg.curriculum_id)) >= 5 THEN
      UPDATE package_steps SET status = 'done'::step_status, finished_at = now() 
      WHERE id = v_pkg.step_id;
      CONTINUE;
    END IF;

    -- Find best document
    SELECT cd.id INTO v_doc
    FROM certification_documents cd
    WHERE cd.certification_id = COALESCE(v_pkg.certification_id, v_pkg.curriculum_id)
      AND cd.status = 'active'
      AND (cd.storage_path IS NOT NULL OR cd.source_url IS NOT NULL)
    ORDER BY cd.legal_priority DESC
    LIMIT 1;

    IF v_doc.id IS NOT NULL THEN
      INSERT INTO job_queue (job_type, payload, priority, status, max_attempts)
      VALUES (
        'package_curriculum_ingest',
        jsonb_build_object(
          'package_id', v_pkg.package_id,
          'document_id', v_doc.id,
          'certification_id', COALESCE(v_pkg.certification_id, v_pkg.curriculum_id),
          'step_id', v_pkg.step_id
        ),
        v_pkg.priority,
        'pending',
        3
      );
      
      UPDATE package_steps SET status = 'running'::step_status, started_at = now(), attempts = attempts + 1
      WHERE id = v_pkg.step_id;
      
      v_triggered := v_triggered + 1;
    ELSE
      UPDATE package_steps 
      SET status = 'skipped'::step_status, 
          last_error = 'No active documents found for certification',
          finished_at = now()
      WHERE id = v_pkg.step_id;
    END IF;
  END LOOP;

  RETURN v_triggered;
END;
$$;

-- =============================================
-- 5. Updated auto_ops_cycle with ingest
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retried integer := 0;
  v_recovered integer := 0;
  v_orphans integer := 0;
  v_cleaned integer := 0;
  v_ingested integer := 0;
  v_priority_ceiling integer;
BEGIN
  PERFORM enforce_priority_gate();
  v_priority_ceiling := get_priority_ceiling();

  -- Auto-trigger curriculum ingest
  v_ingested := auto_trigger_curriculum_ingest();

  -- Retry failed jobs
  UPDATE job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL,
      error = COALESCE(error, '') || ' | AUTO_RETRY',
      run_after = now() + interval '30 seconds'
  WHERE status = 'failed'
    AND attempts < max_attempts
    AND priority <= v_priority_ceiling
    AND updated_at < now() - interval '2 minutes';
  GET DIAGNOSTICS v_retried = ROW_COUNT;

  -- Recover stuck processing jobs
  UPDATE job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL,
      error = COALESCE(error, '') || ' | STUCK_RECOVER',
      run_after = now() + interval '1 minute'
  WHERE status = 'processing'
    AND locked_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  -- Orphan package recovery
  UPDATE course_packages
  SET status = 'queued', current_step = 0
  WHERE status = 'building'
    AND updated_at < now() - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.status IN ('pending', 'processing', 'enqueued')
        AND jq.payload::text LIKE '%' || course_packages.id::text || '%'
    );
  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  -- Cleanup old jobs
  DELETE FROM job_queue
  WHERE status IN ('completed', 'cancelled')
    AND completed_at < now() - interval '7 days';
  GET DIAGNOSTICS v_cleaned = ROW_COUNT;

  -- Auto-unblock packages with valid curricula
  UPDATE course_packages cp
  SET status = 'queued'
  WHERE cp.status = 'blocked'
    AND cp.priority <= v_priority_ceiling
    AND EXISTS (
      SELECT 1 FROM curricula c
      WHERE c.id = cp.curriculum_id
        AND c.status = 'frozen'
        AND EXISTS (SELECT 1 FROM learning_fields lf WHERE lf.curriculum_id = c.id)
    );

  RETURN jsonb_build_object(
    'retried', v_retried,
    'recovered', v_recovered,
    'orphans', v_orphans,
    'cleaned', v_cleaned,
    'ingested', v_ingested,
    'priority_ceiling', v_priority_ceiling,
    'ts', now()
  );
END;
$$;
