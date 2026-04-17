-- 0) Normalize legacy blocked_reason
UPDATE course_packages
SET blocked_reason = 'pipeline_repair_required'
WHERE blocked_reason IN ('pool_fill_in_progress', 'pool_fill_bloom_gaps_in_progress');

-- 1) Add missing routing policies
INSERT INTO llm_provider_routing_policies (route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta)
VALUES
  ('enrichment_default',         'enrichment',         '[{"provider":"openai","model":"gpt-5.4-mini"},{"provider":"openai","model":"gpt-4o-mini"}]'::jsonb, 'cascade', true, '{}'::jsonb),
  ('orchestration_default',      'orchestration',      '[{"provider":"openai","model":"gpt-5.4-mini"},{"provider":"openai","model":"gpt-4o-mini"}]'::jsonb, 'cascade', true, '{}'::jsonb),
  ('blueprint_variants_default', 'blueprint_variants', '[{"provider":"openai","model":"gpt-5.4-mini"},{"provider":"openai","model":"gpt-4o-mini"}]'::jsonb, 'cascade', true, '{}'::jsonb),
  ('blueprint_seed_default',     'blueprint_seed',     '[{"provider":"openai","model":"gpt-5.4-mini"},{"provider":"openai","model":"gpt-4o-mini"}]'::jsonb, 'cascade', true, '{}'::jsonb)
ON CONFLICT (route_key) DO UPDATE SET
  provider_chain = EXCLUDED.provider_chain,
  is_enabled = true,
  updated_at = now();

-- 2) Reset 3 looping jobs
UPDATE job_queue
SET
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL,
  last_error = NULL,
  last_error_code = NULL,
  liveness_status = 'healthy',
  run_after = now(),
  meta = COALESCE(meta, '{}'::jsonb) - 'transient_attempts' - 'first_transient_at'
    - 'same_provider_transient_attempts' - 'last_provider' - 'last_model'
    - 'quarantined_provider' - 'quarantined_model' - 'quarantined_until'
    - 'last_error_kind' - 'last_error_class' - 'last_error_reason'
    || jsonb_build_object('reset_by', 'enrichment_routing_fix', 'reset_at', now())
WHERE id IN (
  '443e278c-fd12-4d26-9be9-956ae95b076f',
  'b6a67ca3-188c-4c02-9539-6dd275c71e52',
  '6c5c7568-0157-40b2-8e58-4d2b7b7c01bb'
);

-- 3) Hard Rebuild Fachinformatiker SI
SELECT admin_force_depublish_and_rebuild('96d0fb31-9951-408d-a83e-b2937f5a6af8'::uuid);

-- 4) Audit
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'fix_enrichment_routing_normalize_reasons_rebuild_si',
  'global',
  jsonb_build_object(
    'root_cause', 'llm_provider_routing_policies missing for enrichment/orchestration/blueprint_* → resolveAvailableRoute returned no_policy → provider=unknown → PROVIDER_LOOP_GUARD never rerouted',
    'fix', '4 routing policies inserted, 3 looping jobs reset, legacy blocked_reasons normalized, Fachinformatiker SI hard-rebuilt'
  ),
  ARRAY[
    '443e278c-fd12-4d26-9be9-956ae95b076f',
    'b6a67ca3-188c-4c02-9539-6dd275c71e52',
    '6c5c7568-0157-40b2-8e58-4d2b7b7c01bb',
    '96d0fb31-9951-408d-a83e-b2937f5a6af8'
  ]::text[]
);