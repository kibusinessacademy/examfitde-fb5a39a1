
-- Reset falsely-done generate_learning_content steps for MFA and PKA
-- MFA (11b697be): 236 needs_regen but step is 'done'
-- PKA (62b52784): 211 needs_regen but step is 'done'
UPDATE package_steps 
SET status = 'running', updated_at = now()
WHERE step_key = 'generate_learning_content'
  AND status = 'done'
  AND package_id IN (
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '62b52784-6d73-458a-9196-631091877c26'
  );
