-- Release all processing jobs back to pending (clean slate for runners)
UPDATE job_queue 
SET status = 'pending', 
    locked_at = NULL, 
    locked_by = NULL, 
    run_after = now() + interval '3 seconds',
    updated_at = now(),
    last_error = 'ADMIN_RELEASE: stuck processing cleanup ' || now()::text
WHERE status = 'processing';
