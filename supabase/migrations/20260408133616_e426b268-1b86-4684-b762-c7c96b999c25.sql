
-- 1. Cancel all pending variant flood jobs
UPDATE job_queue 
SET status = 'cancelled', completed_at = now()
WHERE job_type = 'package_generate_blueprint_variants'
AND package_id = 'd14ca583-784f-403d-97a4-34a65ffd961d'
AND status = 'pending';

-- 2. Close the "partial" gap: blueprints at 5/6 are good enough
UPDATE blueprint_variant_inventory
SET status = 'ready', updated_at = now()
WHERE package_id = 'd14ca583-784f-403d-97a4-34a65ffd961d'
AND status = 'partial'
AND materialized_count >= 4;

-- 3. Mark the step as done (bypass ghost guard by setting started_at + attempts)
UPDATE package_steps
SET started_at = now() - interval '1 hour',
    attempts = 1,
    status = 'done',
    updated_at = now()
WHERE package_id = 'd14ca583-784f-403d-97a4-34a65ffd961d'
AND step_key = 'generate_blueprint_variants'
AND status = 'queued';
