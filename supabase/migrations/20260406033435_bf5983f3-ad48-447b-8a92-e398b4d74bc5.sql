
-- Ghost-Completion Bestandsheilung: inject meta.ok=true so finalization rules auto-close
-- Only for steps with completed jobs and NO active jobs

-- generate_glossary (7 packages)
UPDATE package_steps SET meta = COALESCE(meta, '{}'::jsonb) || '{"ok": true, "healed_by": "ghost_sweep_v1"}'::jsonb
WHERE step_key = 'generate_glossary' AND status NOT IN ('done', 'skipped')
  AND package_id IN (
    '1404f90c-210c-450c-898c-a30b73586502','19553521-e898-4a5f-84fe-30afb78e80e1',
    '1a2aac1c-2505-46c7-beb1-fd9d20fca95d','597ac21f-3bda-4c84-a161-91f817affd7a',
    '5bd82dd6-d203-4b41-9759-09950dfd1ab7','6a2c6859-4b3b-4f6e-b32d-c2574a1333ad',
    '92d333cf-bbd3-4292-b85b-ba933c7c4ae1'
  );

-- auto_seed_exam_blueprints (2 packages, no active jobs)
UPDATE package_steps SET meta = COALESCE(meta, '{}'::jsonb) || '{"ok": true, "healed_by": "ghost_sweep_v1"}'::jsonb
WHERE step_key = 'auto_seed_exam_blueprints' AND status NOT IN ('done', 'skipped')
  AND package_id IN ('6a2c6859-4b3b-4f6e-b32d-c2574a1333ad','fdf4c23c-be16-43ed-ac0e-aea0ab64665f');

-- fanout_learning_content (1 package)
UPDATE package_steps SET meta = COALESCE(meta, '{}'::jsonb) || '{"ok": true, "healed_by": "ghost_sweep_v1"}'::jsonb
WHERE step_key = 'fanout_learning_content' AND status NOT IN ('done', 'skipped')
  AND package_id = '0455666c-52dc-423a-9957-a81f669705ae';

-- generate_blueprint_variants (2 packages, no active jobs)
UPDATE package_steps SET meta = COALESCE(meta, '{}'::jsonb) || '{"ok": true, "healed_by": "ghost_sweep_v1"}'::jsonb
WHERE step_key = 'generate_blueprint_variants' AND status NOT IN ('done', 'skipped')
  AND package_id IN ('f5e3403b-1fc6-46b3-a275-8420287f351e','fec61780-be73-4aca-a88e-1c6f1f39d412');

-- validate_blueprint_variants (3 packages, no active jobs)
UPDATE package_steps SET meta = COALESCE(meta, '{}'::jsonb) || '{"ok": true, "healed_by": "ghost_sweep_v1"}'::jsonb
WHERE step_key = 'validate_blueprint_variants' AND status NOT IN ('done', 'skipped')
  AND package_id IN ('6a2c6859-4b3b-4f6e-b32d-c2574a1333ad','f5e3403b-1fc6-46b3-a275-8420287f351e','fec61780-be73-4aca-a88e-1c6f1f39d412');

-- promote_blueprint_variants (3 packages, no active jobs)
UPDATE package_steps SET meta = COALESCE(meta, '{}'::jsonb) || '{"ok": true, "healed_by": "ghost_sweep_v1"}'::jsonb
WHERE step_key = 'promote_blueprint_variants' AND status NOT IN ('done', 'skipped')
  AND package_id IN ('6a2c6859-4b3b-4f6e-b32d-c2574a1333ad','f5e3403b-1fc6-46b3-a275-8420287f351e','fec61780-be73-4aca-a88e-1c6f1f39d412');

-- validate_handbook (3 packages, no active jobs)
UPDATE package_steps SET meta = COALESCE(meta, '{}'::jsonb) || '{"ok": true, "healed_by": "ghost_sweep_v1"}'::jsonb
WHERE step_key = 'validate_handbook' AND status NOT IN ('done', 'skipped')
  AND package_id IN ('56aee54d-5fd6-4f18-90c0-c6f7f493618a','6a2c6859-4b3b-4f6e-b32d-c2574a1333ad','bae6fc7b-6c03-4716-aeb5-5a84d9bb83af');
