
UPDATE llm_provider_routing_policies
SET provider_chain = '[{"provider":"anthropic","model":"claude-sonnet-4-20250514"},{"provider":"openai","model":"gpt-4o"}]'::jsonb
WHERE workload_key IN ('learning_content','competency_bundle','exam_pool','validation','handbook','campaign_generation','glossary_generation','curriculum_enrichment','exam_blueprint','minichecks','oral_exam','minicheck');
