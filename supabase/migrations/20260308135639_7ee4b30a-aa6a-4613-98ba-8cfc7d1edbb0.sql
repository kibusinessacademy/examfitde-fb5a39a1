
-- Reset the 2 stuck enrichment jobs so they retry with the now-deployed function
UPDATE job_queue
SET status = 'pending', attempts = 0, last_error = NULL, run_after = now()
WHERE job_type = 'generate_curriculum_content'
  AND status = 'pending'
  AND payload->>'curriculum_id' IN (
    '45e6ea8a-6a16-4fa7-94b0-f7707ce53c1c',  -- Elektroniker
    'bd547ecd-6491-4e1f-a581-b2a9718bfee2'   -- Büromanagement
  );
