
-- Universal DAG Guard: prevents inserting jobs whose upstream steps are not done/skipped
CREATE OR REPLACE FUNCTION fn_guard_dag_prerequisites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_key text;
  v_missing text;
BEGIN
  -- Only guard on INSERT of pending/queued jobs
  IF NEW.status NOT IN ('pending', 'queued') THEN
    RETURN NEW;
  END IF;

  -- Allow explicit bypass for admin operations
  IF (NEW.meta->>'dag_bypass')::boolean IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Extract step_key from job_type (strip 'package_' prefix)
  IF NEW.job_type NOT LIKE 'package_%' THEN
    RETURN NEW; -- non-package jobs are not DAG-controlled
  END IF;
  v_step_key := substring(NEW.job_type FROM 9); -- remove 'package_'

  -- Check if this step has any DAG dependencies
  -- If all dependencies are done/skipped, allow; otherwise block
  SELECT string_agg(dag.depends_on, ', ')
  INTO v_missing
  FROM step_dag_edges dag
  JOIN package_steps dep ON dep.package_id = NEW.package_id AND dep.step_key = dag.depends_on
  WHERE dag.step_key = v_step_key
    AND dep.status NOT IN ('done', 'skipped');

  IF v_missing IS NOT NULL THEN
    -- Log the blocked attempt
    INSERT INTO auto_heal_log (
      action_type, trigger_source, target_type, target_id,
      result_status, result_detail, metadata
    ) VALUES (
      'dag_guard_block', 'trg_guard_dag_prerequisites', 'job',
      COALESCE(NEW.package_id::text, 'unknown'),
      'blocked',
      'Blocked ' || NEW.job_type || ': unmet deps = ' || v_missing,
      jsonb_build_object(
        'job_type', NEW.job_type,
        'package_id', NEW.package_id,
        'missing_deps', v_missing
      )
    );
    -- Silently reject the job (RETURN NULL = skip insert)
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach to job_queue BEFORE INSERT
DROP TRIGGER IF EXISTS trg_guard_dag_prerequisites ON job_queue;
CREATE TRIGGER trg_guard_dag_prerequisites
  BEFORE INSERT ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_dag_prerequisites();

-- Log the creation
INSERT INTO admin_actions (user_id, action, scope, payload) VALUES (
  'b0dbd616-9b93-47c8-83c5-39290130a6ea',
  'create_dag_guard_trigger',
  'job_queue',
  '{"description": "Universal DAG guard prevents inserting jobs with unmet prerequisites in step_dag_edges"}'::jsonb
);
