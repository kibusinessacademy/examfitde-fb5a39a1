
-- Enqueue 18 missing jobs with correct curriculum_id in payload
INSERT INTO job_queue (job_type, package_id, payload, priority, status, created_at)
VALUES
  ('package_build_ai_tutor_index', 'b960658d-95e9-4824-a404-821d5e9b5142', '{"package_id":"b960658d-95e9-4824-a404-821d5e9b5142","curriculum_id":"c2e41dc3-0fdb-4906-a694-485d0ddea180","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_run_integrity_check', 'b960658d-95e9-4824-a404-821d5e9b5142', '{"package_id":"b960658d-95e9-4824-a404-821d5e9b5142","curriculum_id":"c2e41dc3-0fdb-4906-a694-485d0ddea180","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_elite_harden', 'ccdcb409-b708-460c-834d-254a382f8b28', '{"package_id":"ccdcb409-b708-460c-834d-254a382f8b28","curriculum_id":"0e2605f4-20f8-44c8-b224-4b97a3511add","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_oral_exam', 'ccdcb409-b708-460c-834d-254a382f8b28', '{"package_id":"ccdcb409-b708-460c-834d-254a382f8b28","curriculum_id":"0e2605f4-20f8-44c8-b224-4b97a3511add","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_handbook', '24c3793c-30b0-43a7-bd5d-cfed0c40542d', '{"package_id":"24c3793c-30b0-43a7-bd5d-cfed0c40542d","curriculum_id":"a8a6340d-fd50-445f-a55b-7d5a6c72e2e1","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_lesson_minichecks', '24c3793c-30b0-43a7-bd5d-cfed0c40542d', '{"package_id":"24c3793c-30b0-43a7-bd5d-cfed0c40542d","curriculum_id":"a8a6340d-fd50-445f-a55b-7d5a6c72e2e1","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_exam_pool', '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2', '{"package_id":"2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2","curriculum_id":"cdb12a5a-2c21-408a-8879-ef5afa52057d","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_glossary', '2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2', '{"package_id":"2378b40e-f6ca-4f6f-84c8-b7c741c7d5f2","curriculum_id":"cdb12a5a-2c21-408a-8879-ef5afa52057d","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_exam_pool', '96d0fb31-9951-408d-a83e-b2937f5a6af8', '{"package_id":"96d0fb31-9951-408d-a83e-b2937f5a6af8","curriculum_id":"53d13046-88bf-42bf-9a2e-05d5e4a4f272","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_elite_harden', 'f2039067-e58a-4e94-9573-b5953d435873', '{"package_id":"f2039067-e58a-4e94-9573-b5953d435873","curriculum_id":"516618c7-ba4d-4e1a-bee6-b609b513ebd3","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_elite_harden', '38f58d97-20a2-49b5-8ba4-737a7887d521', '{"package_id":"38f58d97-20a2-49b5-8ba4-737a7887d521","curriculum_id":"cb6e221d-120c-4bad-8c50-ea94e8b803d6","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_handbook', 'd14ca583-784f-403d-97a4-34a65ffd961d', '{"package_id":"d14ca583-784f-403d-97a4-34a65ffd961d","curriculum_id":"5dcaaddd-59f4-439c-a7d3-2be161d86277","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_validate_blueprints', 'd14ca583-784f-403d-97a4-34a65ffd961d', '{"package_id":"d14ca583-784f-403d-97a4-34a65ffd961d","curriculum_id":"5dcaaddd-59f4-439c-a7d3-2be161d86277","triggered_by":"admin_materialization_fix"}', 5, 'pending', now()),
  ('package_enqueue_handbook_expand', 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af', '{"package_id":"bae6fc7b-6c03-4716-aeb5-5a84d9bb83af","curriculum_id":"192af095-c7b8-4556-b0a7-246ef54749e1","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_run_integrity_check', 'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af', '{"package_id":"bae6fc7b-6c03-4716-aeb5-5a84d9bb83af","curriculum_id":"192af095-c7b8-4556-b0a7-246ef54749e1","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_build_ai_tutor_index', 'fec61780-be73-4aca-a88e-1c6f1f39d412', '{"package_id":"fec61780-be73-4aca-a88e-1c6f1f39d412","curriculum_id":"7907a655-598b-4465-85dc-8d89d6837d3d","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_elite_harden', 'fec61780-be73-4aca-a88e-1c6f1f39d412', '{"package_id":"fec61780-be73-4aca-a88e-1c6f1f39d412","curriculum_id":"7907a655-598b-4465-85dc-8d89d6837d3d","triggered_by":"admin_materialization_fix"}', 10, 'pending', now()),
  ('package_generate_oral_exam', 'fec61780-be73-4aca-a88e-1c6f1f39d412', '{"package_id":"fec61780-be73-4aca-a88e-1c6f1f39d412","curriculum_id":"7907a655-598b-4465-85dc-8d89d6837d3d","triggered_by":"admin_materialization_fix"}', 10, 'pending', now())
ON CONFLICT DO NOTHING;

-- Create auto-materializer function that closes the step→job gap
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
    SELECT ps.package_id, ps.step_key, cp.curriculum_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE cp.status = 'building'
      AND ps.status = 'queued'
      -- All DAG prereqs are terminal
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps dep ON dep.package_id = ps.package_id AND dep.step_key = dag.depends_on
        WHERE dag.step_key = ps.step_key AND dep.status NOT IN ('done', 'skipped')
      )
      -- No active job already exists
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status IN ('pending', 'processing')
      )
      -- No recently completed job (within 2 min, avoid double-fire)
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
