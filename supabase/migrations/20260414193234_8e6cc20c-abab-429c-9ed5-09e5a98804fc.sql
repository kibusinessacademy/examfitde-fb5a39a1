
-- Backfill: Set blueprint pipeline steps to done for Personalfachkaufmann and Wirtschaftsfachwirt
-- Both have >= 10 approved blueprints (48 and 78 respectively)
UPDATE package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'done_reason', 'redundant_seeding_backfill_v3',
      'auto_completed_at', now()
    )
WHERE package_id IN (
  '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',  -- Personalfachkaufmann
  '03462382-f62e-4be9-9940-013d42a4435b'    -- Wirtschaftsfachwirt
)
AND step_key IN ('generate_blueprint_variants', 'validate_blueprint_variants', 'promote_blueprint_variants')
AND status = 'queued';
