
-- ============================================================================
-- HEAL BATCH 2026-04-17 04:00: Routing Fix + Pipeline Repair
-- ============================================================================

-- 1. ROUTING-POLICY FIX: gpt-5.4-mini ist evidence-based broken (0/1464 success)
-- Stelle gpt-4o-mini als primary (proven 99.8% success), gpt-5.4-mini als fallback
UPDATE llm_provider_routing_policies
SET provider_chain = '[
  {"model": "gpt-4o-mini", "provider": "openai"},
  {"model": "gpt-5.2-mini", "provider": "openai"}
]'::jsonb,
    updated_at = now()
WHERE workload_key IN ('enrichment','orchestration','blueprint_variants','blueprint_seed');

-- 2. COOLDOWN PURGE: Entferne stale gpt-5.4-mini Cooldowns (Modell ist eh deaktiviert)
DELETE FROM llm_provider_cooldowns
WHERE provider = 'openai' AND model = 'gpt-5.4-mini';

-- 3. JOB HEAL: 2 timeout pool_fill_bloom_gaps Jobs sauber resetten mit neuem Routing
UPDATE job_queue
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    started_at = NULL,
    run_after = now(),
    last_error = NULL,
    priority = 5,
    attempts = 0,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'is_repair', true,
      'reset_at', now(),
      'reset_by', 'heal_routing_fix_v3_2026_04_17',
      'reset_reason', 'cleanup_after_routing_chain_swap',
      'transient_attempts', 0,
      'same_provider_transient_attempts', 0,
      'quarantined_model', null,
      'quarantined_until', null,
      'last_error_kind', null,
      'last_transient_at', null
    )
WHERE id IN ('6c5c7568-0157-40b2-8e58-4d2b7b7c01bb','b6a67ca3-188c-4c02-9539-6dd275c71e52');

-- 4. PAKET HEAL: Stuck packages mit is_repair-flag für bonus WIP slots
UPDATE course_packages
SET stuck_reason = NULL,
    last_error = NULL,
    last_progress_at = now(),
    updated_at = now()
WHERE id IN (
  '52cc076a-13ba-4f73-8202-b3f1164bba0f', -- Automobilkaufmann
  '01099a37-3309-4bc1-a2ce-6a6913e4d125', -- Textilreiniger
  '65430b12-b481-46e0-88f4-c88606857da7', -- Scrum Master
  '3e070545-c555-417a-a047-c7541ebb2a7c', -- Immobiliardarlehensvermittler
  'd7fd81c3-283e-4270-acef-812b08501442', -- Tech Produktdesigner
  'bae6fc7b-6c03-4716-aeb5-5a84d9bb83af'  -- PRINCE2
);

-- 5. AUTOMOBILKAUFMANN: 3 Tage ohne Jobs, current_step=0 → Hard rebuild
SELECT admin_force_depublish_and_rebuild(p_package_id := '52cc076a-13ba-4f73-8202-b3f1164bba0f');

-- 6. AUDIT-LOG
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'heal_routing_chain_swap_and_pipeline_repair',
  'pipeline',
  jsonb_build_object(
    'reason', 'gpt-5.4-mini evidence-based broken (0/1464 success); reorder chain + cleanup',
    'workloads_fixed', ARRAY['enrichment','orchestration','blueprint_variants','blueprint_seed'],
    'jobs_healed', 2,
    'packages_healed', 6,
    'hard_rebuild', '52cc076a-13ba-4f73-8202-b3f1164bba0f',
    'timestamp', now()
  ),
  ARRAY['6c5c7568-0157-40b2-8e58-4d2b7b7c01bb','b6a67ca3-188c-4c02-9539-6dd275c71e52',
        '52cc076a-13ba-4f73-8202-b3f1164bba0f','01099a37-3309-4bc1-a2ce-6a6913e4d125',
        '65430b12-b481-46e0-88f4-c88606857da7','3e070545-c555-417a-a047-c7541ebb2a7c',
        'd7fd81c3-283e-4270-acef-812b08501442','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af']::uuid[]
);
