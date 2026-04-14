
-- Backfill v4: Blueprint pipeline steps to done for Personalfachkaufmann and Wirtschaftsfachwirt
-- Previous backfill (v3) was not applied - these steps are still 'queued'
-- Both packages have sufficient blueprints and don't need seeding

UPDATE public.package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'done_reason', 'redundant_seeding_backfill_v4',
      'auto_completed_at', now()
    )
WHERE package_id IN (
  '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',  -- Personalfachkaufmann
  '03462382-f62e-4be9-9940-013d42a4435b'    -- Wirtschaftsfachwirt
)
AND step_key IN ('generate_blueprint_variants', 'validate_blueprint_variants', 'promote_blueprint_variants')
AND status = 'queued';

-- Also clean up the now-DAG-unblockable pending jobs that reference these steps
-- The remaining pending jobs for these packages will naturally become claimable
-- once the blueprint steps are done (DAG filter passes)
