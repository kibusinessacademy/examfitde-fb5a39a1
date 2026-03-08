
-- Timeout-optimized LLM routing policies (6 workload classes)

-- 1. LESSON CONTENT (mass fan-out, timeout-critical)
INSERT INTO public.llm_provider_routing_policies (
  route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta, updated_at
) VALUES (
  'route.learning_content',
  'learning_content',
  '[
    {"provider":"google","model":"gemini-2.5-flash","role":"fast_primary","timeout_ms":20000},
    {"provider":"openai","model":"gpt-5-mini","role":"fast_backup","timeout_ms":22000},
    {"provider":"anthropic","model":"claude-sonnet","role":"rescue_structured","timeout_ms":26000},
    {"provider":"openai","model":"gpt-5","role":"rescue_quality","timeout_ms":28000}
  ]'::jsonb,
  'ordered', true,
  jsonb_build_object('strategy','timeout_optimized','notes','Mass fan-out path. Fast models first, rescue only afterwards.','max_plain_retry',1,'workload_class','timeout_critical'),
  now()
) ON CONFLICT (route_key) DO UPDATE SET
  workload_key=EXCLUDED.workload_key, provider_chain=EXCLUDED.provider_chain,
  fallback_mode=EXCLUDED.fallback_mode, is_enabled=EXCLUDED.is_enabled,
  meta=EXCLUDED.meta, updated_at=now();

-- 2. CURRICULUM ENRICHMENT (structural, timeout-sensitive)
INSERT INTO public.llm_provider_routing_policies (
  route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta, updated_at
) VALUES (
  'route.curriculum_enrichment',
  'curriculum_enrichment',
  '[
    {"provider":"openai","model":"gpt-5-mini","role":"structured_primary","timeout_ms":25000},
    {"provider":"anthropic","model":"claude-sonnet","role":"structured_backup","timeout_ms":30000},
    {"provider":"google","model":"gemini-2.5-pro","role":"rescue_reasoning","timeout_ms":32000},
    {"provider":"google","model":"gemini-2.5-flash","role":"last_resort_fast","timeout_ms":22000}
  ]'::jsonb,
  'ordered', true,
  jsonb_build_object('strategy','timeout_optimized','notes','Enrichment must stay structured, but cannot block factory for too long.','max_plain_retry',1,'workload_class','structured_timeout_sensitive'),
  now()
) ON CONFLICT (route_key) DO UPDATE SET
  workload_key=EXCLUDED.workload_key, provider_chain=EXCLUDED.provider_chain,
  fallback_mode=EXCLUDED.fallback_mode, is_enabled=EXCLUDED.is_enabled,
  meta=EXCLUDED.meta, updated_at=now();

-- 3. GLOSSARY GENERATION (short, schema-strict, low timeout)
INSERT INTO public.llm_provider_routing_policies (
  route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta, updated_at
) VALUES (
  'route.glossary_generation',
  'glossary_generation',
  '[
    {"provider":"openai","model":"gpt-5-mini","role":"fast_structured_primary","timeout_ms":16000},
    {"provider":"google","model":"gemini-2.5-flash","role":"fast_backup","timeout_ms":14000},
    {"provider":"anthropic","model":"claude-sonnet","role":"rescue_structured","timeout_ms":22000}
  ]'::jsonb,
  'ordered', true,
  jsonb_build_object('strategy','timeout_optimized','notes','Short structured output. Do not waste slow models first.','max_plain_retry',1,'workload_class','short_structured'),
  now()
) ON CONFLICT (route_key) DO UPDATE SET
  workload_key=EXCLUDED.workload_key, provider_chain=EXCLUDED.provider_chain,
  fallback_mode=EXCLUDED.fallback_mode, is_enabled=EXCLUDED.is_enabled,
  meta=EXCLUDED.meta, updated_at=now();

-- 4. EXAM BLUEPRINTS / EXAM POOL (quality-sensitive)
INSERT INTO public.llm_provider_routing_policies (
  route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta, updated_at
) VALUES (
  'route.exam_blueprint',
  'exam_blueprint',
  '[
    {"provider":"openai","model":"gpt-5-mini","role":"quality_primary","timeout_ms":24000},
    {"provider":"anthropic","model":"claude-sonnet","role":"quality_backup","timeout_ms":30000},
    {"provider":"openai","model":"gpt-5","role":"rescue_quality","timeout_ms":34000},
    {"provider":"google","model":"gemini-2.5-pro","role":"last_resort","timeout_ms":32000}
  ]'::jsonb,
  'ordered', true,
  jsonb_build_object('strategy','timeout_optimized','notes','Quality-sensitive, but should not start with the slowest path.','max_plain_retry',1,'workload_class','quality_sensitive'),
  now()
) ON CONFLICT (route_key) DO UPDATE SET
  workload_key=EXCLUDED.workload_key, provider_chain=EXCLUDED.provider_chain,
  fallback_mode=EXCLUDED.fallback_mode, is_enabled=EXCLUDED.is_enabled,
  meta=EXCLUDED.meta, updated_at=now();

-- 5. VALIDATION / QUALITY COUNCIL (precision over speed)
INSERT INTO public.llm_provider_routing_policies (
  route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta, updated_at
) VALUES (
  'route.validation',
  'validation',
  '[
    {"provider":"anthropic","model":"claude-sonnet","role":"precision_primary","timeout_ms":35000},
    {"provider":"openai","model":"gpt-5","role":"precision_backup","timeout_ms":36000},
    {"provider":"openai","model":"gpt-5-mini","role":"fallback_fast","timeout_ms":22000}
  ]'::jsonb,
  'ordered', true,
  jsonb_build_object('strategy','timeout_aware_precision','notes','Low-volume validation path. Higher timeout budget acceptable.','max_plain_retry',1,'workload_class','precision_low_volume'),
  now()
) ON CONFLICT (route_key) DO UPDATE SET
  workload_key=EXCLUDED.workload_key, provider_chain=EXCLUDED.provider_chain,
  fallback_mode=EXCLUDED.fallback_mode, is_enabled=EXCLUDED.is_enabled,
  meta=EXCLUDED.meta, updated_at=now();

-- 6. CAMPAIGN GENERATION (volume + timeout critical)
INSERT INTO public.llm_provider_routing_policies (
  route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta, updated_at
) VALUES (
  'route.campaign_generation',
  'campaign_generation',
  '[
    {"provider":"google","model":"gemini-2.5-flash","role":"fast_primary","timeout_ms":14000},
    {"provider":"openai","model":"gpt-5-mini","role":"fast_backup","timeout_ms":16000},
    {"provider":"anthropic","model":"claude-sonnet","role":"premium_rescue","timeout_ms":22000}
  ]'::jsonb,
  'ordered', true,
  jsonb_build_object('strategy','timeout_optimized','notes','Volume-first asset generation. Premium model only as rescue.','max_plain_retry',1,'workload_class','volume_timeout_critical'),
  now()
) ON CONFLICT (route_key) DO UPDATE SET
  workload_key=EXCLUDED.workload_key, provider_chain=EXCLUDED.provider_chain,
  fallback_mode=EXCLUDED.fallback_mode, is_enabled=EXCLUDED.is_enabled,
  meta=EXCLUDED.meta, updated_at=now();
