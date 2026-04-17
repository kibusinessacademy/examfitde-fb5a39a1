-- Heal: Reset 3 TIMEOUT pool_fill_bloom_gaps Jobs + Cleanup failed Validate-Leiche
-- 1. Failed Validate-Job (Fachinformatiker SI) löschen — Paket ist bereits via Hard-Rebuild gesetzt
DELETE FROM job_queue
WHERE id = '3bac3742-337d-4590-b9a3-033ed8dfbc65';

-- 2. 3 TIMEOUT pool_fill_bloom_gaps Jobs requeuen mit Priority 5 + is_repair Flag
UPDATE job_queue
SET status = 'pending',
    attempts = 0,
    priority = 5,
    locked_by = NULL,
    locked_at = NULL,
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'is_repair', true,
      'reset_at', now(),
      'reset_reason', 'edge_function_timeout_45s_requeue',
      'guard_state', NULL,
      'hard_stall_count', 0
    ),
    updated_at = now()
WHERE id IN (
  '443e278c-fd12-4d26-9be9-956ae95b076f',
  '6c5c7568-0157-40b2-8e58-4d2b7b7c01bb',
  'b6a67ca3-188c-4c02-9539-6dd275c71e52'
);

-- 3. Pakete der Repair-Jobs als is_repair markieren (Bonus-WIP-Slots)
UPDATE course_packages
SET is_repair = true,
    updated_at = now()
WHERE id IN (
  '3e070545-c555-417a-a047-c7541ebb2a7c', -- Immobiliardarlehen
  '01099a37-3309-4bc1-a2ce-6a6913e4d125', -- Textilreiniger
  '65430b12-b481-46e0-88f4-c88606857da7'  -- Scrum Master
);

-- 4. Audit-Log
INSERT INTO admin_actions (action, scope, payload, affected_ids)
VALUES (
  'heal_pool_fill_timeout_batch',
  'pipeline',
  jsonb_build_object(
    'reason', 'pool_fill_bloom_gaps edge function 45s timeout — requeued with priority 5 + is_repair',
    'failed_job_purged', '3bac3742-337d-4590-b9a3-033ed8dfbc65',
    'requeued_count', 3,
    'packages_marked_repair', 3
  ),
  ARRAY[
    '3e070545-c555-417a-a047-c7541ebb2a7c',
    '01099a37-3309-4bc1-a2ce-6a6913e4d125',
    '65430b12-b481-46e0-88f4-c88606857da7',
    '96d0fb31-9951-408d-a83e-b2937f5a6af8'
  ]::text[]
);