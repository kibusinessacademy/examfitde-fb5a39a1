
-- Fix the auto_gap_close job payload to reference the ACTIVE autofix run
UPDATE job_queue
SET payload = jsonb_set(
  payload,
  '{autofix_run_id}',
  '"fab40d70-9d0e-445b-a935-3a0e00843e30"'::jsonb
),
updated_at = now(),
run_after = now()
WHERE id = '8cf78021-d0a1-495b-81b1-26207b350695'
  AND status = 'pending';

-- Audit
INSERT INTO admin_actions (action, scope, affected_ids, payload)
VALUES ('fix_autofix_run_id_in_gap_close_job', 'job_queue',
  ARRAY['8cf78021-d0a1-495b-81b1-26207b350695'],
  '{"reason":"Job payload referenced old failed autofix_run_id 918b793d. Updated to active run fab40d70."}'::jsonb);
