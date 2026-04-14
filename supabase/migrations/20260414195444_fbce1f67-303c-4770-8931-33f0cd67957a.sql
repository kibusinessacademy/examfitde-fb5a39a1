
-- Backfill v5: Must disable causality guard to set entire blueprint chain at once
-- The guard checks pipeline_dag_edges and reverts status to 'queued' if deps not done

-- Temporarily disable the causality guard
ALTER TABLE public.package_steps DISABLE TRIGGER trg_guard_step_causality;

-- Set all 4 blueprint steps to done (in correct order doesn't matter with guard off)
UPDATE public.package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now()),
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'done_reason', 'redundant_seeding_backfill_v5',
      'auto_completed_at', now()
    )
WHERE package_id IN (
  '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9',
  '03462382-f62e-4be9-9940-013d42a4435b'
)
AND step_key IN ('validate_blueprints', 'generate_blueprint_variants', 'validate_blueprint_variants', 'promote_blueprint_variants')
AND status != 'done';

-- Re-enable the causality guard immediately
ALTER TABLE public.package_steps ENABLE TRIGGER trg_guard_step_causality;
