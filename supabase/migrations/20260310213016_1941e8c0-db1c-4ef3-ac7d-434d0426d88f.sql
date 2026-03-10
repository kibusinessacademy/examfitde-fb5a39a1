-- Fix routing: Anthropic primary (Lovable gateway returns empty), reset stuck job
UPDATE llm_provider_routing_policies 
SET provider_chain = '[{"provider":"anthropic","model":"claude-sonnet-4-5-20250929","role":"primary","timeout_ms":42000},{"provider":"lovable","model":"openai/gpt-5","role":"fallback","timeout_ms":38000}]'::jsonb, 
    updated_at = NOW() 
WHERE workload_key = 'learning_content' AND is_enabled = true;

-- Reset stuck job
UPDATE job_queue 
SET status = 'pending', 
    locked_at = NULL, 
    locked_by = NULL, 
    last_error_code = 'MANUAL_RESET',
    meta = COALESCE(meta, '{}'::jsonb) || '{"same_provider_transient_attempts": 0, "transient_attempts": 0, "attempt_index": 0}'::jsonb,
    run_after = NOW()
WHERE id = 'd1416b66-60b4-462f-8bd9-33b2947925a6';

-- Clear any active cooldowns
DELETE FROM llm_provider_cooldowns WHERE until_at > NOW();