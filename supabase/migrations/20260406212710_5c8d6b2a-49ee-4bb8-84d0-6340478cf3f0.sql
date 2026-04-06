
ALTER TABLE public.job_type_policies
  ADD COLUMN IF NOT EXISTS worker_pool text DEFAULT 'default';

UPDATE public.job_type_policies
SET worker_pool = 'prebuild'
WHERE job_type IN (
  'package_generate_blueprint_variants',
  'package_validate_blueprint_variants',
  'package_promote_blueprint_variants'
);

INSERT INTO public.job_type_policies (job_type, is_repair, can_run_when_not_building, exempt_from_auto_cancel, worker_pool, notes)
VALUES
  ('ensure_variant_inventory', false, true, false, 'prebuild', 'Planner: Soll/Ist-Abgleich Blueprint-Varianten'),
  ('validate_variant_inventory', false, true, false, 'prebuild', 'Prüft Variant Coverage und setzt Prebuild-Status')
ON CONFLICT (job_type) DO UPDATE SET
  worker_pool = EXCLUDED.worker_pool,
  can_run_when_not_building = EXCLUDED.can_run_when_not_building,
  notes = EXCLUDED.notes;
