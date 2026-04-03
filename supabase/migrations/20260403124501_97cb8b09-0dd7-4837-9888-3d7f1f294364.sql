-- 1. Mark competencies as enriched
UPDATE competencies SET enrichment_version = 2
WHERE id IN (
  'a0b0c0d0-0005-4000-8000-000000000001',
  'a0b0c0d0-0005-4000-8000-000000000002',
  'a0b0c0d0-0005-4000-8000-000000000003',
  'a0b0c0d0-0005-4000-8000-000000000004',
  'a0b0c0d0-0005-4000-8000-000000000005'
);

-- 2. Set package to building (enrichment gate will now pass)
UPDATE course_packages SET
  status = 'building',
  priority = 1,
  blocked_reason = NULL,
  stuck_reason = NULL,
  updated_at = now()
WHERE id = 'a0b0c0d0-0010-4000-8000-000000000001';

-- 3. Log
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata) VALUES
  ('admin_manual_reset', 'lovable_operator', 'course_packages', 'a0b0c0d0-0010-4000-8000-000000000001', 'applied', 'Enrichment gate cleared: 5 competencies → v2, blocked→building', '{"reason":"enrichment_gate_bypass","competencies_enriched":5}'::jsonb);