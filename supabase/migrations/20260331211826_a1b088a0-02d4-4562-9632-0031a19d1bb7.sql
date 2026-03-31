-- Reset integrity check steps to queued so they re-run after repair
UPDATE package_steps
SET status = 'queued', updated_at = now()
WHERE package_id IN ('335decc8-9f68-4784-b318-a68f620bf77e', 'eff99cc4-785d-4f61-a3ef-12932d8043c3')
  AND step_key = 'run_integrity_check'
  AND status = 'done';

-- Enqueue new repair jobs with curriculum_id
INSERT INTO job_queue (job_type, package_id, priority, payload, status)
VALUES
  ('package_repair_exam_pool_quality', '335decc8-9f68-4784-b318-a68f620bf77e', 10, 
   '{"package_id": "335decc8-9f68-4784-b318-a68f620bf77e", "curriculum_id": "7790d18f-8fb8-450a-9eb2-e2264d0c76c9", "triggered_by": "manual_fix_rebalance_upgrade"}'::jsonb, 'pending'),
  ('package_repair_exam_pool_quality', 'eff99cc4-785d-4f61-a3ef-12932d8043c3', 10,
   '{"package_id": "eff99cc4-785d-4f61-a3ef-12932d8043c3", "curriculum_id": "d9716bca-0052-4f61-a9db-3520861b58cb", "triggered_by": "manual_fix_rebalance_upgrade"}'::jsonb, 'pending');