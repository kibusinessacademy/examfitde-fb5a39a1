UPDATE llm_provider_routing_policies
SET provider_chain = '[
  {"model": "gpt-5.4-mini", "provider": "openai"},
  {"model": "gpt-4o-mini", "provider": "openai"}
]'::jsonb,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'hotfix_2026_04_27', 'invalid_gpt_5_2_mini_fallback_replaced',
      'previous_chain_was', 'gpt-4o-mini -> gpt-5.2-mini (5.2-mini does not exist)'
    ),
    updated_at = now()
WHERE workload_key IN ('blueprint_variants', 'blueprint_seed', 'enrichment', 'orchestration')
  AND provider_chain::text LIKE '%gpt-5.2-mini%';

UPDATE job_queue
SET status = 'pending',
    attempts = 0,
    last_error = NULL,
    run_after = now() + interval '5 seconds',
    priority = 10,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'routing_hotfix_recovery_at', now()::text,
      'previous_attempts_before_reset', attempts
    ),
    updated_at = now()
WHERE job_type IN ('package_promote_blueprint_variants', 'package_generate_blueprint_variants')
  AND last_error LIKE '%PROVIDER_LOOP_GUARD%'
  AND status IN ('failed', 'pending');

INSERT INTO admin_actions (action, payload, user_id)
VALUES (
  'routing_policy_hotfix',
  jsonb_build_object(
    'reason', 'gpt-5.2-mini does not exist in Lovable AI Gateway -> infinite reroute loop',
    'updated_workloads', ARRAY['blueprint_variants', 'blueprint_seed', 'enrichment', 'orchestration'],
    'new_chain', 'gpt-5.4-mini -> gpt-4o-mini'
  ),
  NULL
);