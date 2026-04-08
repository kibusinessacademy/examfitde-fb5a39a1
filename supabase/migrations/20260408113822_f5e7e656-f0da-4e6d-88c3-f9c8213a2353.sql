
CREATE OR REPLACE FUNCTION public.fn_materialize_ready_step_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id, c.id as course_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.curriculum_id = cp.curriculum_id
    WHERE cp.status = 'building'
      AND ps.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps dep ON dep.package_id = ps.package_id AND dep.step_key = dag.depends_on
        WHERE dag.step_key = ps.step_key AND dep.status NOT IN ('done', 'skipped')
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status IN ('pending', 'processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status = 'completed'
        AND jq.completed_at > now() - interval '2 minutes'
      )
  LOOP
    INSERT INTO job_queue (job_type, package_id, payload, priority, status, created_at)
    VALUES (
      'package_' || rec.step_key,
      rec.package_id,
      jsonb_build_object(
        'package_id', rec.package_id,
        'curriculum_id', rec.curriculum_id,
        'course_id', rec.course_id,
        'triggered_by', 'auto_materializer'
      ),
      10,
      'pending',
      now()
    )
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;
