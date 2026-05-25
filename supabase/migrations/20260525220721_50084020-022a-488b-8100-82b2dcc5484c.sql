
UPDATE public.ops_audit_contract
SET required_keys = ARRAY['workflow_id','workflow_slug','workflow_tier','blocked_reason','tier_actual','tier_required','runs_today','daily_limit','entitlement_snapshot'],
    owner_module = 'berufs_ki_monetization'
WHERE action_type = 'workflow_tier_blocked';

UPDATE public.ops_audit_contract
SET required_keys = ARRAY['workflow_id','workflow_slug','workflow_tier','usage_bucket','ai_model','runs_today','daily_limit','entitlement_snapshot'],
    owner_module = 'berufs_ki_monetization'
WHERE action_type = 'workflow_run_granted';

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('workflow_ai_call_attempted',
   ARRAY['workflow_id','workflow_slug','workflow_tier','ai_model','estimated_prompt_tokens','estimated_cost_bucket'],
   'berufs_ki_monetization'),
  ('workflow_ai_call_completed',
   ARRAY['workflow_id','workflow_slug','workflow_tier','ai_model','tokens_in','tokens_out','latency_ms','estimated_cost_bucket'],
   'berufs_ki_monetization'),
  ('workflow_cost_guard_blocked',
   ARRAY['workflow_id','workflow_slug','workflow_tier','blocked_reason','estimated_prompt_tokens','prompt_chars'],
   'berufs_ki_monetization'),
  ('workflow_abuse_guard_blocked',
   ARRAY['workflow_id','workflow_slug','workflow_tier','blocked_reason','window_seconds','recent_run_count'],
   'berufs_ki_monetization')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module = EXCLUDED.owner_module,
      updated_at = now();
