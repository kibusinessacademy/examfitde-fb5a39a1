-- v15: Full pipeline reset after timeout fix (38s→48s default, 48s→50s lesson cap)
-- Delete all lesson_generate_content jobs
DELETE FROM job_queue WHERE job_type IN ('lesson_generate_content', 'lesson_generate_competency_bundle', 'package_generate_learning_content');

-- Clear all provider cooldowns
TRUNCATE llm_provider_cooldowns;

-- Release all leases
DELETE FROM package_leases;

-- Reset generate_learning_content steps that are running/failed back to queued
UPDATE package_steps 
SET status = 'queued', started_at = NULL, last_error = NULL, updated_at = now()
WHERE step_key = 'generate_learning_content' 
  AND status IN ('running', 'failed');

-- Remove lovable from routing policies
DELETE FROM llm_provider_routing_policies WHERE provider_chain::text ILIKE '%lovable%';

-- Remove lovable from model_routing_rules
DELETE FROM model_routing_rules WHERE provider = 'lovable';