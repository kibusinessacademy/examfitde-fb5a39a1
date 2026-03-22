
-- Cancel existing pending integrity job for Industriemechaniker
UPDATE job_queue
SET status = 'cancelled', last_error = 'Superseded by reconcile patch v2', updated_at = now()
WHERE package_id = '9c1b3734-bb25-4986-baef-5bb1c20a212c'
AND job_type = 'package_run_integrity_check'
AND status IN ('pending', 'failed');

-- Now insert fresh integrity jobs for all 4
INSERT INTO job_queue (package_id, job_type, status, priority, worker_pool, payload, meta)
VALUES
  ('fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'package_run_integrity_check', 'pending', 1, 'core',
   '{"package_id":"fd1d8192-a16f-496b-80c8-5e06f70ec21a","curriculum_id":"e06a570a-d810-410d-873a-c87229465f41"}'::jsonb,
   '{"source":"integrity_reconcile_patch_v2"}'::jsonb),
  ('59b6e214-e181-4c2b-986e-1ce544984d04', 'package_run_integrity_check', 'pending', 1, 'core',
   '{"package_id":"59b6e214-e181-4c2b-986e-1ce544984d04","curriculum_id":"63635f46-0186-49e7-80c1-67925dbdf638"}'::jsonb,
   '{"source":"integrity_reconcile_patch_v2"}'::jsonb),
  ('2e8da39f-60f8-44d9-8b70-e1176222ca55', 'package_run_integrity_check', 'pending', 1, 'core',
   '{"package_id":"2e8da39f-60f8-44d9-8b70-e1176222ca55","curriculum_id":"e24f7b10-0740-4729-8abe-e10fe765f6db"}'::jsonb,
   '{"source":"integrity_reconcile_patch_v2"}'::jsonb),
  ('9c1b3734-bb25-4986-baef-5bb1c20a212c', 'package_run_integrity_check', 'pending', 1, 'core',
   '{"package_id":"9c1b3734-bb25-4986-baef-5bb1c20a212c","curriculum_id":"2c01d31e-e7ed-4b82-b04e-d5094d1dc179"}'::jsonb,
   '{"source":"integrity_reconcile_patch_v2"}'::jsonb);

-- PATCH E: Harden reconcile RPC
CREATE OR REPLACE FUNCTION reconcile_council_approval()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fixed int := 0; v_pkg record;
BEGIN
  FOR v_pkg IN
    SELECT cp.id FROM course_packages cp
    WHERE cp.council_approved IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM council_sessions cs WHERE cs.package_id = cp.id AND cs.status NOT IN ('completed','cancelled','skipped'))
      AND EXISTS (SELECT 1 FROM council_sessions cs WHERE cs.package_id = cp.id)
  LOOP
    UPDATE course_packages SET council_approved = true, council_approved_at = COALESCE(council_approved_at, now()), updated_at = now() WHERE id = v_pkg.id;
    UPDATE package_steps SET status = 'done', started_at = COALESCE(started_at, now()), attempts = GREATEST(attempts, 1), updated_at = now()
    WHERE package_id = v_pkg.id AND step_key = 'quality_council' AND status <> 'done';
    v_fixed := v_fixed + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'fixed', v_fixed);
END; $$;
