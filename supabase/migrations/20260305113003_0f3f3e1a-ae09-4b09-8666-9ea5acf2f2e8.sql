-- Reset falsely-done steps back to 'running' so dispatcher can re-evaluate
update package_steps 
set status = 'running', updated_at = now()
where step_key = 'generate_learning_content'
  and status = 'done'
  and package_id in (
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '62b52784-6d73-458a-9196-631091877c26',
    '59b6e214-e181-4c2b-986e-1ce544984d04'
  )