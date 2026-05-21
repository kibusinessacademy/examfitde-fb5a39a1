INSERT INTO ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('ai_gateway_route_resolved', ARRAY['provider','model_in','model_out','target']::text[], 'ai-client'),
  ('ai_gateway_bypass_cluster_closed', ARRAY['cluster_key','prior_24h_count']::text[], 'ai-client')
ON CONFLICT (action_type) DO NOTHING;

SELECT public.fn_emit_audit(
  _action_type := 'ai_gateway_bypass_cluster_closed',
  _target_type := 'system',
  _result_status := 'success',
  _payload := jsonb_build_object(
    'cluster_key','ai_gateway_bypass',
    'prior_24h_count', (
      SELECT COUNT(*) FROM job_queue
      WHERE updated_at > now() - interval '24 hours'
        AND (last_error ~* 'invalid model id|google_ai_api_key not configured')
    ),
    'fix_summary','callAI provider=openai|google now routes through ai.gateway.lovable.dev with auto-prefixed model IDs; generate-seo-slug + curriculum-import migrated; CI guard extended.',
    'guards','no-direct-llm-fetch-guard extended for api.openai.com|api.anthropic.com|generativelanguage.googleapis.com'
  ),
  _trigger_source := 'migration_2026_05_21_ai_gateway_ssot'
);