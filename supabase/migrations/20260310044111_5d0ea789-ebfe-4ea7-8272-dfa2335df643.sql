-- Reset the current pending handbook job back to fresh state
UPDATE job_queue
SET attempts = 0,
    last_error = NULL,
    updated_at = now(),
    meta = jsonb_build_object('reset_reason', 'MIN_WORD_TARGET ReferenceError fixed')
WHERE id = '6649a532-2bf3-4b85-b647-21ef5783f6e9'
  AND package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';